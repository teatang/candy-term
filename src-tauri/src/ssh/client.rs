use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, KeyboardInteractiveAuthResponse, Msg};
use russh::keys::{decode_secret_key, load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{Channel, ChannelMsg, ChannelOpenFailure, Pty};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, RwLock};

use crate::error::{AppError, AppResult};
use crate::models::{
    ActiveTunnel, AuthMethod, HostKeyChallengePayload, HostProfile, PortForwardRule, ProxyConfig,
    ServerMetrics, SessionStatusPayload, TerminalOutputPayload,
};
use crate::ssh::forward::{start_forward_rule, RemoteForwardMap, RunningForward};
use crate::ssh::metrics::{parse_metrics_output, METRICS_PROBE_CMD};
use crate::ssh::proxy::{connect_via_http, connect_via_socks5};
use crate::storage::{HostKeyStatus, JsonStore};

/// 发往后台 PTY 协程的控制命令
pub enum PtyCommand {
    Write(Vec<u8>),
    Resize(u32, u32),
    Close,
}

/// 单个已建立 SSH 会话的运行时上下文
pub struct SshSessionEntry {
    pub handle: Arc<client::Handle<CandyClientHandler>>,
    pub pty_tx: mpsc::Sender<PtyCommand>,
    pub remote_forwards: RemoteForwardMap,
    pub running_forwards: RwLock<HashMap<String, RunningForward>>,
}

/// 实现 `russh::client::Handler`，负责主机指纹校验与远程端口转发入站分发
pub struct CandyClientHandler {
    pub app: Option<AppHandle>,
    pub session_id: String,
    pub host_port: String,
    pub store: JsonStore,
    pub pending_challenges: Arc<RwLock<HashMap<String, oneshot::Sender<bool>>>>,
    pub remote_forwards: RemoteForwardMap,
    /// 测试连通性或跳板机内部连接时可设为 true 自动信任新密钥
    pub auto_accept_unknown_key: bool,
}

impl client::Handler for CandyClientHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let (algorithm, fingerprint) = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => (
                key.algorithm().to_string(),
                key.fingerprint(HashAlg::Sha256).to_string(),
            ),
            PublicKeyOrCertificate::Certificate(cert) => (
                cert.algorithm().to_string(),
                cert.public_key().fingerprint(HashAlg::Sha256).to_string(),
            ),
        };

        let status = self
            .store
            .check_host_key(&self.host_port, &fingerprint)
            .await?;

        match status {
            HostKeyStatus::Trusted => Ok(true),
            HostKeyStatus::Unknown if self.auto_accept_unknown_key => {
                self.store
                    .trust_host_key(self.host_port.clone(), algorithm, fingerprint)
                    .await?;
                Ok(true)
            }
            HostKeyStatus::Unknown | HostKeyStatus::Changed { .. } => {
                let Some(app) = &self.app else {
                    // 无 UI 上下文（如仅做内部连接探测）时默认仅放行未知主机，拒绝已变更主机
                    return Ok(matches!(status, HostKeyStatus::Unknown));
                };

                let challenge_id = uuid::Uuid::new_v4().to_string();
                let (tx, rx) = oneshot::channel::<bool>();
                {
                    let mut guard = self.pending_challenges.write().await;
                    guard.insert(challenge_id.clone(), tx);
                }

                let changed = matches!(status, HostKeyStatus::Changed { .. });
                let _ = app.emit(
                    "ssh://host-key-challenge",
                    HostKeyChallengePayload {
                        challenge_id: challenge_id.clone(),
                        session_id: self.session_id.clone(),
                        host_port: self.host_port.clone(),
                        algorithm: algorithm.clone(),
                        fingerprint: fingerprint.clone(),
                        changed,
                    },
                );

                // 等待用户确认（最多 120 秒超时）
                let trusted = tokio::time::timeout(Duration::from_secs(120), rx)
                    .await
                    .ok()
                    .and_then(|r| r.ok())
                    .unwrap_or(false);

                {
                    let mut guard = self.pending_challenges.write().await;
                    guard.remove(&challenge_id);
                }

                if trusted {
                    self.store
                        .trust_host_key(self.host_port.clone(), algorithm, fingerprint)
                        .await?;
                }
                Ok(trusted)
            }
        }
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let target = {
            let guard = self.remote_forwards.read().await;
            guard
                .get(&(connected_address.to_string(), connected_port))
                .cloned()
                .or_else(|| {
                    guard
                        .iter()
                        .find(|((_, port), _)| *port == connected_port)
                        .map(|(_, v)| v.clone())
                })
        };

        let Some((local_host, local_port)) = target else {
            reply
                .reject(ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        };

        reply.accept().await;
        tokio::spawn(async move {
            if let Ok(mut local_stream) = TcpStream::connect((local_host.as_str(), local_port)).await {
                let mut ssh_stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut local_stream, &mut ssh_stream).await;
            }
        });
        Ok(())
    }
}

/// 全局 SSH 会话池与连接管理器
pub struct SshManager {
    pub store: JsonStore,
    pub sessions: RwLock<HashMap<String, Arc<SshSessionEntry>>>,
    pub pending_challenges: Arc<RwLock<HashMap<String, oneshot::Sender<bool>>>>,
}

impl SshManager {
    pub fn new(store: JsonStore) -> Self {
        Self {
            store,
            sessions: RwLock::new(HashMap::new()),
            pending_challenges: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 响应前端发回的主机指纹信任结果
    pub async fn respond_host_key_challenge(&self, challenge_id: &str, trust: bool) -> AppResult<()> {
        let tx = {
            let mut guard = self.pending_challenges.write().await;
            guard.remove(challenge_id)
        };
        if let Some(sender) = tx {
            let _ = sender.send(trust);
        }
        Ok(())
    }

    /// 按主机配置（含代理/跳板机与多重认证）建立并完成认证的 russh 客户端句柄
    fn connect_and_authenticate<'a>(
        &'a self,
        app: Option<AppHandle>,
        session_id: String,
        host: &'a HostProfile,
        all_hosts: &'a [HostProfile],
        auto_accept_unknown_key: bool,
        visited_jump_ids: &'a mut HashSet<String>,
    ) -> Pin<Box<dyn Future<Output = AppResult<(client::Handle<CandyClientHandler>, RemoteForwardMap)>> + Send + 'a>> {
        Box::pin(async move {
            let mut config = client::Config::default();
            if host.keepalive_interval_secs > 0 {
                config.keepalive_interval = Some(Duration::from_secs(host.keepalive_interval_secs));
                config.keepalive_max = 3;
            }
            let config = Arc::new(config);
            let remote_forwards: RemoteForwardMap = Arc::new(RwLock::new(HashMap::new()));
            let handler = CandyClientHandler {
                app: app.clone(),
                session_id: session_id.clone(),
                host_port: format!("{}:{}", host.host, host.port),
                store: self.store.clone(),
                pending_challenges: self.pending_challenges.clone(),
                remote_forwards: remote_forwards.clone(),
                auto_accept_unknown_key,
            };

            let mut handle = match &host.proxy {
                ProxyConfig::None => {
                    client::connect(config, (host.host.as_str(), host.port), handler)
                        .await
                        .map_err(|e| AppError::Ssh(format!("TCP/SSH 连接失败: {e}")))?
                }
                ProxyConfig::Socks5 {
                    host: p_host,
                    port: p_port,
                    username,
                    password,
                } => {
                    let stream = connect_via_socks5(
                        p_host,
                        *p_port,
                        &host.host,
                        host.port,
                        username.as_deref(),
                        password.as_deref(),
                    )
                    .await?;
                    client::connect_stream(config, stream, handler)
                        .await
                        .map_err(|e| AppError::Ssh(format!("经 SOCKS5 建连失败: {e}")))?
                }
                ProxyConfig::Http {
                    host: p_host,
                    port: p_port,
                    username,
                    password,
                } => {
                    let stream = connect_via_http(
                        p_host,
                        *p_port,
                        &host.host,
                        host.port,
                        username.as_deref(),
                        password.as_deref(),
                    )
                    .await?;
                    client::connect_stream(config, stream, handler)
                        .await
                        .map_err(|e| AppError::Ssh(format!("经 HTTP 代理建连失败: {e}")))?
                }
                ProxyConfig::JumpHost { jump_host_id } => {
                    if !visited_jump_ids.insert(jump_host_id.clone()) {
                        return Err(AppError::Proxy("检测到循环跳板机配置，请检查代理链".into()));
                    }
                    let jump_profile = all_hosts
                        .iter()
                        .find(|h| &h.id == jump_host_id)
                        .ok_or_else(|| AppError::Proxy("指定的跳板机配置不存在".into()))?;
                    let (jump_handle, _) = self
                        .connect_and_authenticate(
                            app.clone(),
                            format!("{session_id}:jump"),
                            jump_profile,
                            all_hosts,
                            auto_accept_unknown_key,
                            visited_jump_ids,
                        )
                        .await?;

                    let tunnel_channel = jump_handle
                        .channel_open_direct_tcpip(
                            host.host.clone(),
                            host.port as u32,
                            "127.0.0.1",
                            0,
                        )
                        .await
                        .map_err(|e| AppError::Proxy(format!("跳板机转发通道建立失败: {e}")))?;

                    // 保持跳板机句柄存活直到主连接关闭
                    let stream = tunnel_channel.into_stream();
                    let next = client::connect_stream(config, stream, handler)
                        .await
                        .map_err(|e| AppError::Ssh(format!("经跳板机建连失败: {e}")))?;
                    std::mem::forget(jump_handle);
                    next
                }
            };

            authenticate_handle(&mut handle, &host.username, &host.auth).await?;
            Ok((handle, remote_forwards))
        })
    }

    /// 测试主机连通性与认证是否正常（完成后立即优雅断开）
    pub async fn test_connection(
        &self,
        host: HostProfile,
        all_hosts: Vec<HostProfile>,
    ) -> AppResult<String> {
        let mut visited = HashSet::new();
        visited.insert(host.id.clone());
        let (handle, _) = self
            .connect_and_authenticate(
                None,
                format!("test-{}", uuid::Uuid::new_v4()),
                &host,
                &all_hosts,
                true,
                &mut visited,
            )
            .await?;
        let _ = handle
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
        Ok(format!("Connected to {}@{}:{}", host.username, host.host, host.port))
    }

    /// 建立持久交互式终端会话并开启后台 PTY 读写事件循环
    pub async fn connect_session(
        &self,
        app: AppHandle,
        session_id: String,
        host: HostProfile,
        all_hosts: Vec<HostProfile>,
        cols: u32,
        rows: u32,
    ) -> AppResult<()> {
        let mut visited = HashSet::new();
        visited.insert(host.id.clone());
        let (handle, remote_forwards) = self
            .connect_and_authenticate(
                Some(app.clone()),
                session_id.clone(),
                &host,
                &all_hosts,
                false,
                &mut visited,
            )
            .await?;

        let handle = Arc::new(handle);
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| AppError::Ssh(format!("打开终端会话通道失败: {e}")))?;

        channel
            .request_pty(
                true,
                "xterm-256color",
                cols.max(20),
                rows.max(5),
                0,
                0,
                &[(Pty::ECHO, 1)],
            )
            .await
            .map_err(|e| AppError::Ssh(format!("请求远程 PTY 失败: {e}")))?;

        channel
            .request_shell(true)
            .await
            .map_err(|e| AppError::Ssh(format!("启动远程 Shell 失败: {e}")))?;

        let (pty_tx, mut pty_rx) = mpsc::channel::<PtyCommand>(128);
        let entry = Arc::new(SshSessionEntry {
            handle: handle.clone(),
            pty_tx,
            remote_forwards,
            running_forwards: RwLock::new(HashMap::new()),
        });

        {
            let mut guard = self.sessions.write().await;
            guard.insert(session_id.clone(), entry);
        }

        // 启动独立 PTY 双向流协程
        let ev_app = app.clone();
        let ev_sid = session_id.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    cmd = pty_rx.recv() => {
                        match cmd {
                            Some(PtyCommand::Write(bytes)) => {
                                if channel.data(&bytes[..]).await.is_err() {
                                    break;
                                }
                            }
                            Some(PtyCommand::Resize(c, r)) => {
                                let _ = channel.window_change(c, r, 0, 0).await;
                            }
                            Some(PtyCommand::Close) | None => {
                                let _ = channel.eof().await;
                                let _ = channel.close().await;
                                break;
                            }
                        }
                    }
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                                let text = String::from_utf8_lossy(&data).into_owned();
                                let _ = ev_app.emit("ssh://output", TerminalOutputPayload {
                                    session_id: ev_sid.clone(),
                                    data: text,
                                });
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                                let _ = ev_app.emit("ssh://status", SessionStatusPayload {
                                    session_id: ev_sid.clone(),
                                    status: "disconnected".to_string(),
                                    message: None,
                                });
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        Ok(())
    }

    pub async fn get_session(&self, session_id: &str) -> AppResult<Arc<SshSessionEntry>> {
        let guard = self.sessions.read().await;
        guard
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::SessionNotFound(session_id.to_string()))
    }

    pub async fn write_input(&self, session_id: &str, data: &str) -> AppResult<()> {
        let session = self.get_session(session_id).await?;
        session
            .pty_tx
            .send(PtyCommand::Write(data.as_bytes().to_vec()))
            .await
            .map_err(|_| AppError::SessionNotFound(session_id.to_string()))
    }

    pub async fn resize_pty(&self, session_id: &str, cols: u32, rows: u32) -> AppResult<()> {
        let session = self.get_session(session_id).await?;
        let _ = session.pty_tx.send(PtyCommand::Resize(cols, rows)).await;
        Ok(())
    }

    pub async fn disconnect(&self, session_id: &str) -> AppResult<()> {
        let entry = {
            let mut guard = self.sessions.write().await;
            guard.remove(session_id)
        };
        if let Some(session) = entry {
            {
                let mut forwards = session.running_forwards.write().await;
                for (_, rf) in forwards.drain() {
                    rf.cancel.cancel();
                }
            }
            let _ = session.pty_tx.send(PtyCommand::Close).await;
            let _ = session
                .handle
                .disconnect(russh::Disconnect::ByApplication, "User disconnected", "en")
                .await;
        }
        Ok(())
    }

    /// 启动或替换会话中的某条端口转发规则
    pub async fn start_forward(
        &self,
        session_id: &str,
        rule: PortForwardRule,
    ) -> AppResult<ActiveTunnel> {
        let session = self.get_session(session_id).await?;
        {
            let mut guard = session.running_forwards.write().await;
            if let Some(existing) = guard.remove(&rule.id) {
                existing.cancel.cancel();
            }
        }
        let (tunnel, running) = start_forward_rule(
            session_id,
            session.handle.clone(),
            session.remote_forwards.clone(),
            rule.clone(),
        )
        .await?;
        session
            .running_forwards
            .write()
            .await
            .insert(rule.id, running);
        Ok(tunnel)
    }

    /// 停止会话中指定 ID 的端口转发规则
    pub async fn stop_forward(&self, session_id: &str, rule_id: &str) -> AppResult<()> {
        let session = self.get_session(session_id).await?;
        let removed = session.running_forwards.write().await.remove(rule_id);
        if let Some(rf) = removed {
            rf.cancel.cancel();
        }
        Ok(())
    }

    /// 在独立 exec 通道执行系统监控采集命令并返回指标
    pub async fn fetch_metrics(&self, session_id: &str) -> AppResult<ServerMetrics> {
        let session = self.get_session(session_id).await?;
        let mut channel = session
            .handle
            .channel_open_session()
            .await
            .map_err(|e| AppError::Ssh(format!("打开监控命令通道失败: {e}")))?;

        channel
            .exec(true, METRICS_PROBE_CMD)
            .await
            .map_err(|e| AppError::Ssh(format!("执行远程监控采集失败: {e}")))?;

        let mut output = Vec::new();
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => output.extend_from_slice(&data),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        let text = String::from_utf8_lossy(&output);
        parse_metrics_output(&text)
    }
}

/// 根据认证配置完成 SSH 身份验证（支持密码、私钥、SSH Agent、键盘交互）
async fn authenticate_handle(
    handle: &mut client::Handle<CandyClientHandler>,
    username: &str,
    auth: &AuthMethod,
) -> AppResult<()> {
    match auth {
        AuthMethod::Password { password } => {
            let res = handle
                .authenticate_password(username, password)
                .await
                .map_err(|e| AppError::Auth(format!("密码认证通信异常: {e}")))?;
            if !matches!(res, AuthResult::Success) {
                return Err(AppError::Auth("用户名或密码被服务器拒绝".into()));
            }
        }
        AuthMethod::PrivateKey {
            private_key_path,
            private_key_content,
            passphrase,
        } => {
            let pass_opt = passphrase.as_deref().filter(|s| !s.is_empty());
            let key = if let Some(content) = private_key_content.as_deref().filter(|s| !s.trim().is_empty()) {
                decode_secret_key(content, pass_opt)
                    .map_err(|e| AppError::Auth(format!("解析内联私钥失败: {e}")))?
            } else if let Some(path_str) = private_key_path.as_deref().filter(|s| !s.trim().is_empty()) {
                let expanded = expand_tilde_path(path_str);
                load_secret_key(&expanded, pass_opt)
                    .map_err(|e| AppError::Auth(format!("加载私钥文件失败 ({expanded}): {e}")))?
            } else {
                return Err(AppError::InvalidInput("请选择私钥文件或粘贴私钥内容".into()));
            };

            let key = Arc::new(key);
            let hash_alg = if key.algorithm().is_rsa() {
                handle
                    .best_supported_rsa_hash()
                    .await
                    .ok()
                    .flatten()
                    .flatten()
                    .or(Some(HashAlg::Sha256))
            } else {
                None
            };

            let res = handle
                .authenticate_publickey(username, PrivateKeyWithHashAlg::new(key, hash_alg))
                .await
                .map_err(|e| AppError::Auth(format!("公钥认证通信异常: {e}")))?;
            if !matches!(res, AuthResult::Success) {
                return Err(AppError::Auth("私钥未被目标服务器接受".into()));
            }
        }
        AuthMethod::Agent => {
            let mut agent = russh::keys::agent::client::AgentClient::connect_env()
                .await
                .map_err(|e| AppError::Auth(format!("无法连接本地 SSH Agent (SSH_AUTH_SOCK): {e}")))?;
            let identities = agent
                .request_identities()
                .await
                .map_err(|e| AppError::Auth(format!("读取 SSH Agent 密钥列表失败: {e}")))?;
            if identities.is_empty() {
                return Err(AppError::Auth("本地 SSH Agent 中没有可用密钥".into()));
            }

            let mut authenticated = false;
            for id in identities {
                let pub_key = id.public_key().into_owned();
                let hash_alg = if pub_key.algorithm().is_rsa() {
                    Some(HashAlg::Sha256)
                } else {
                    None
                };
                if let Ok(AuthResult::Success) = handle
                    .authenticate_publickey_with(username, pub_key, hash_alg, &mut agent)
                    .await
                {
                    authenticated = true;
                    break;
                }
            }
            if !authenticated {
                return Err(AppError::Auth("SSH Agent 中所有密钥均未通过服务器认证".into()));
            }
        }
        AuthMethod::KeyboardInteractive { password } => {
            let mut resp = handle
                .authenticate_keyboard_interactive_start(username, None)
                .await
                .map_err(|e| AppError::Auth(format!("键盘交互认证启动失败: {e}")))?;

            loop {
                match resp {
                    KeyboardInteractiveAuthResponse::Success => break,
                    KeyboardInteractiveAuthResponse::Failure { .. } => {
                        return Err(AppError::Auth("键盘交互认证被拒绝".into()));
                    }
                    KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                        let answers = vec![password.clone().unwrap_or_default(); prompts.len()];
                        resp = handle
                            .authenticate_keyboard_interactive_respond(answers)
                            .await
                            .map_err(|e| AppError::Auth(format!("键盘交互响应失败: {e}")))?;
                    }
                }
            }
        }
    }
    Ok(())
}

/// 展开路径前导 `~` 为当前用户主目录
pub fn expand_tilde_path(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    raw.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_tilde_path() {
        std::env::set_var("HOME", "/Users/tester");
        assert_eq!(expand_tilde_path("~/.ssh/id_ed25519"), "/Users/tester/.ssh/id_ed25519");
        assert_eq!(expand_tilde_path("/etc/ssh/key"), "/etc/ssh/key");
    }
}
