use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::models::{ActiveTunnel, ForwardType, PortForwardRule};
use crate::ssh::client::CandyClientHandler;

/// 远程端口转发映射表：`(绑定地址, 绑定端口)` -> `(本地目标主机, 本地目标端口)`
pub type RemoteForwardMap = Arc<RwLock<HashMap<(String, u32), (String, u16)>>>;

/// 正在运行的端口转发句柄，用于优雅停止隧道任务
pub struct RunningForward {
    pub rule: PortForwardRule,
    pub cancel: CancellationToken,
}

/// 解析客户端发来的 SOCKS5 CONNECT 请求头（支持 IPv4、域名与 IPv6）
pub async fn parse_socks5_connect_target<S>(stream: &mut S) -> AppResult<(String, u16)>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    // 1. 方法协商
    let mut ver_nmethods = [0u8; 2];
    stream.read_exact(&mut ver_nmethods).await?;
    if ver_nmethods[0] != 0x05 {
        return Err(AppError::Forward("仅支持 SOCKS5 协议".into()));
    }
    let mut methods = vec![0u8; ver_nmethods[1] as usize];
    stream.read_exact(&mut methods).await?;
    // 响应无需认证 (0x00)
    stream.write_all(&[0x05, 0x00]).await?;

    // 2. 读取 CONNECT 请求头
    let mut head = [0u8; 4];
    stream.read_exact(&mut head).await?;
    if head[0] != 0x05 || head[1] != 0x01 {
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Err(AppError::Forward("仅支持 SOCKS5 CONNECT 命令".into()));
    }

    let target_host = match head[3] {
        0x01 => {
            let mut ip = [0u8; 4];
            stream.read_exact(&mut ip).await?;
            Ipv4Addr::from(ip).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            let mut domain = vec![0u8; len[0] as usize];
            stream.read_exact(&mut domain).await?;
            String::from_utf8(domain)
                .map_err(|_| AppError::Forward("无效的 SOCKS5 域名".into()))?
        }
        0x04 => {
            let mut ip = [0u8; 16];
            stream.read_exact(&mut ip).await?;
            Ipv6Addr::from(ip).to_string()
        }
        _ => {
            return Err(AppError::Forward("不支持的 SOCKS5 地址类型".into()));
        }
    };

    let mut port_buf = [0u8; 2];
    stream.read_exact(&mut port_buf).await?;
    let target_port = u16::from_be_bytes(port_buf);

    Ok((target_host, target_port))
}

/// 启动端口转发规则（支持 Local -L / Remote -R / Dynamic -D SOCKS5）
pub async fn start_forward_rule(
    session_id: &str,
    handle: Arc<russh::client::Handle<CandyClientHandler>>,
    remote_map: RemoteForwardMap,
    rule: PortForwardRule,
) -> AppResult<(ActiveTunnel, RunningForward)> {
    let cancel = CancellationToken::new();
    let bind_addr = format!("{}:{}", rule.local_host, rule.local_port);

    match rule.forward_type {
        ForwardType::Local => {
            let listener = TcpListener::bind(&bind_addr)
                .await
                .map_err(|e| AppError::Forward(format!("绑定本地端口 {bind_addr} 失败: {e}")))?;
            let actual_addr = listener.local_addr()?.to_string();
            let target_addr = format!("{}:{}", rule.remote_host, rule.remote_port);

            let task_cancel = cancel.clone();
            let remote_host = rule.remote_host.clone();
            let remote_port = rule.remote_port as u32;
            let local_bind = rule.local_host.clone();
            let local_port = rule.local_port as u32;

            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = task_cancel.cancelled() => break,
                        accepted = listener.accept() => {
                            let Ok((mut inbound, _)) = accepted else { break; };
                            let h = handle.clone();
                            let r_host = remote_host.clone();
                            let l_host = local_bind.clone();
                            tokio::spawn(async move {
                                if let Ok(ch) = h
                                    .channel_open_direct_tcpip(r_host, remote_port, l_host, local_port)
                                    .await
                                {
                                    let mut ssh_stream = ch.into_stream();
                                    let _ = tokio::io::copy_bidirectional(&mut inbound, &mut ssh_stream).await;
                                }
                            });
                        }
                    }
                }
            });

            Ok((
                ActiveTunnel {
                    rule_id: rule.id.clone(),
                    session_id: session_id.to_string(),
                    name: rule.name.clone(),
                    forward_type: ForwardType::Local,
                    bind_address: actual_addr,
                    target_address: target_addr,
                    status: "running".to_string(),
                    error: None,
                },
                RunningForward { rule, cancel },
            ))
        }

        ForwardType::Dynamic => {
            let listener = TcpListener::bind(&bind_addr)
                .await
                .map_err(|e| AppError::Forward(format!("绑定 SOCKS5 端口 {bind_addr} 失败: {e}")))?;
            let actual_addr = listener.local_addr()?.to_string();

            let task_cancel = cancel.clone();
            let local_bind = rule.local_host.clone();
            let local_port = rule.local_port as u32;

            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = task_cancel.cancelled() => break,
                        accepted = listener.accept() => {
                            let Ok((mut inbound, _)) = accepted else { break; };
                            let h = handle.clone();
                            let l_host = local_bind.clone();
                            tokio::spawn(async move {
                                if let Ok((target_host, target_port)) = parse_socks5_connect_target(&mut inbound).await {
                                    match h.channel_open_direct_tcpip(target_host, target_port as u32, l_host, local_port).await {
                                        Ok(ch) => {
                                            let _ = inbound.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
                                            let mut ssh_stream = ch.into_stream();
                                            let _ = tokio::io::copy_bidirectional(&mut inbound, &mut ssh_stream).await;
                                        }
                                        Err(_) => {
                                            let _ = inbound.write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
                                        }
                                    }
                                }
                            });
                        }
                    }
                }
            });

            Ok((
                ActiveTunnel {
                    rule_id: rule.id.clone(),
                    session_id: session_id.to_string(),
                    name: rule.name.clone(),
                    forward_type: ForwardType::Dynamic,
                    bind_address: actual_addr,
                    target_address: "SOCKS5 Dynamic".to_string(),
                    status: "running".to_string(),
                    error: None,
                },
                RunningForward { rule, cancel },
            ))
        }

        ForwardType::Remote => {
            let key = (rule.remote_host.clone(), rule.remote_port as u32);
            {
                let mut guard = remote_map.write().await;
                guard.insert(key.clone(), (rule.local_host.clone(), rule.local_port));
            }

            let bound_port = handle
                .tcpip_forward(rule.remote_host.clone(), rule.remote_port as u32)
                .await
                .map_err(|e| AppError::Forward(format!("远程端口转发注册失败: {e}")))?;

            let actual_remote_port = if bound_port > 0 {
                bound_port
            } else {
                rule.remote_port as u32
            };

            if actual_remote_port != rule.remote_port as u32 {
                let mut guard = remote_map.write().await;
                guard.remove(&key);
                guard.insert(
                    (rule.remote_host.clone(), actual_remote_port),
                    (rule.local_host.clone(), rule.local_port),
                );
            }

            let cancel_watcher = cancel.clone();
            let cleanup_handle = handle.clone();
            let cleanup_map = remote_map.clone();
            let r_host = rule.remote_host.clone();
            tokio::spawn(async move {
                cancel_watcher.cancelled().await;
                {
                    let mut guard = cleanup_map.write().await;
                    guard.remove(&(r_host.clone(), actual_remote_port));
                }
                let _ = cleanup_handle
                    .cancel_tcpip_forward(r_host, actual_remote_port)
                    .await;
            });

            Ok((
                ActiveTunnel {
                    rule_id: rule.id.clone(),
                    session_id: session_id.to_string(),
                    name: rule.name.clone(),
                    forward_type: ForwardType::Remote,
                    bind_address: format!("{}:{}", rule.remote_host, actual_remote_port),
                    target_address: bind_addr,
                    status: "running".to_string(),
                    error: None,
                },
                RunningForward { rule, cancel },
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_parse_socks5_connect_domain_and_ipv4_targets() {
        // 1. 测试域名类型请求
        let (mut client, mut server) = tokio::io::duplex(512);
        let client_task = tokio::spawn(async move {
            client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
            let mut method_resp = [0u8; 2];
            client.read_exact(&mut method_resp).await.unwrap();
            assert_eq!(method_resp, [0x05, 0x00]);

            let mut req = vec![0x05, 0x01, 0x00, 0x03, 15];
            req.extend_from_slice(b"api.example.com");
            req.extend_from_slice(&443u16.to_be_bytes());
            client.write_all(&req).await.unwrap();
        });

        let (host, port) = parse_socks5_connect_target(&mut server).await.unwrap();
        assert_eq!(host, "api.example.com");
        assert_eq!(port, 443);
        client_task.await.unwrap();

        // 2. 测试 IPv4 地址类型请求
        let (mut c2, mut s2) = tokio::io::duplex(512);
        tokio::spawn(async move {
            c2.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
            let mut m = [0u8; 2];
            c2.read_exact(&mut m).await.unwrap();
            c2.write_all(&[0x05, 0x01, 0x00, 0x01, 10, 0, 0, 8, 0x14, 0xeb])
                .await
                .unwrap();
        });
        let (ip_host, ip_port) = parse_socks5_connect_target(&mut s2).await.unwrap();
        assert_eq!(ip_host, "10.0.0.8");
        assert_eq!(ip_port, 5355);
    }
}
