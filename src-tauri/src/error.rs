use serde::Serialize;
use thiserror::Error;

/// 应用统一错误枚举，可自动序列化返回给前端 Tauri IPC 调用方
#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 序列化/反序列化错误: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("SSH 协议错误: {0}")]
    Ssh(String),

    #[error("SSH 认证失败: {0}")]
    Auth(String),

    #[error("SFTP 操作失败: {0}")]
    Sftp(String),

    #[error("代理连接失败: {0}")]
    Proxy(String),

    #[error("端口转发失败: {0}")]
    Forward(String),

    #[error("会话未找到或已断开: {0}")]
    SessionNotFound(String),

    #[error("配置参数无效: {0}")]
    InvalidInput(String),
}

impl From<russh::Error> for AppError {
    fn from(err: russh::Error) -> Self {
        Self::Ssh(err.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
