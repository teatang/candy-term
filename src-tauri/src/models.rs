use serde::{Deserialize, Serialize};

/// SSH 认证方式枚举（与前端 TypeScript AuthMethod 对齐）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AuthMethod {
    /// 密码认证
    Password { password: String },
    /// 私钥认证（支持文件路径或内联 PEM/OpenSSH 文本及可选解密密码）
    PrivateKey {
        #[serde(rename = "privateKeyPath")]
        private_key_path: Option<String>,
        #[serde(rename = "privateKeyContent")]
        private_key_content: Option<String>,
        passphrase: Option<String>,
    },
    /// 使用本地 SSH Agent（如 ssh-agent / Pageant / 1Password Agent）
    Agent,
    /// 键盘交互式认证 (Keyboard-Interactive)
    KeyboardInteractive { password: Option<String> },
}

/// 代理与跳板机配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ProxyConfig {
    /// 直连模式
    None,
    /// SOCKS5 代理模式
    Socks5 {
        host: String,
        port: u16,
        username: Option<String>,
        password: Option<String>,
    },
    /// HTTP CONNECT 隧道代理模式
    Http {
        host: String,
        port: u16,
        username: Option<String>,
        password: Option<String>,
    },
    /// 通过已保存的另一台 SSH 主机作为跳板机 (ProxyJump)
    JumpHost {
        #[serde(rename = "jumpHostId")]
        jump_host_id: String,
    },
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self::None
    }
}

/// 端口转发类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ForwardType {
    /// 本地端口转发 (-L)
    Local,
    /// 远程端口转发 (-R)
    Remote,
    /// 动态 SOCKS5 代理 (-D)
    Dynamic,
}

/// 端口转发规则配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardRule {
    pub id: String,
    pub name: String,
    pub forward_type: ForwardType,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub auto_start: bool,
}

/// 主机连接配置模型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub group: String,
    pub color: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub notes: String,
    pub auth: AuthMethod,
    #[serde(default)]
    pub proxy: ProxyConfig,
    #[serde(default)]
    pub forwards: Vec<PortForwardRule>,
    #[serde(default = "default_keepalive")]
    pub keepalive_interval_secs: u64,
    pub last_connected_at: Option<i64>,
}

fn default_keepalive() -> u64 {
    30
}

/// 活动端口转发隧道状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTunnel {
    pub rule_id: String,
    pub session_id: String,
    pub name: String,
    pub forward_type: ForwardType,
    pub bind_address: String,
    pub target_address: String,
    pub status: String,
    pub error: Option<String>,
}

/// SFTP 文件/目录条目信息
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub permissions: String,
    pub modified_at: Option<i64>,
}

/// SFTP 目录列表响应体
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListResult {
    pub resolved_path: String,
    pub entries: Vec<SftpEntry>,
}

/// SFTP 文件传输进度事件载荷
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferProgress {
    pub transfer_id: String,
    pub session_id: String,
    pub file_name: String,
    pub direction: String,
    pub transferred: u64,
    pub total: u64,
    pub done: bool,
}

/// 远程服务器系统监控指标
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerMetrics {
    pub hostname: String,
    pub os_name: String,
    pub kernel: String,
    pub uptime_seconds: u64,
    pub load_avg: [f64; 3],
    pub cpu_usage_percent: f64,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub collected_at: i64,
}

/// 已知信任主机公钥指纹记录
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostEntry {
    pub host_port: String,
    pub algorithm: String,
    pub fingerprint: String,
    pub trusted_at: i64,
}

/// 快捷命令片段配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSnippet {
    pub id: String,
    pub title: String,
    pub command: String,
    pub category: String,
    pub description: Option<String>,
}

/// 终端输出流事件载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputPayload {
    pub session_id: String,
    pub data: String,
}

/// 会话状态变更事件载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatusPayload {
    pub session_id: String,
    pub status: String,
    pub message: Option<String>,
}

/// 未知或变更的主机公钥指纹交互式确认载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyChallengePayload {
    pub challenge_id: String,
    pub session_id: String,
    pub host_port: String,
    pub algorithm: String,
    pub fingerprint: String,
    pub changed: bool,
}
