use std::path::Path;
use std::sync::Arc;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileType, OpenFlags};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::{AppError, AppResult};
use crate::models::{SftpEntry, SftpListResult, SftpTransferProgress};
use crate::ssh::client::CandyClientHandler;

/// 远程 POSIX 路径拼接（统一使用 `/` 分隔符）
pub fn join_remote_path(dir: &str, name: &str) -> String {
    let clean_name = name.trim_start_matches('/');
    if dir.is_empty() || dir == "/" {
        format!("/{clean_name}")
    } else {
        format!("{}/{clean_name}", dir.trim_end_matches('/'))
    }
}

/// 将 Unix st_mode 权限位格式化为标准 `drwxr-xr-x` 字符串
pub fn format_unix_mode(mode: u32, is_dir: bool, is_symlink: bool) -> String {
    let kind = if is_symlink {
        'l'
    } else if is_dir {
        'd'
    } else {
        '-'
    };
    let flags = [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ];
    let mut out = String::with_capacity(10);
    out.push(kind);
    for (mask, ch) in flags {
        out.push(if mode & mask != 0 { ch } else { '-' });
    }
    out
}

/// 在现有 SSH 会话上打开独立的 SFTP 子系统通道
pub async fn open_sftp_session(
    handle: &Arc<russh::client::Handle<CandyClientHandler>>,
) -> AppResult<SftpSession> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Sftp(format!("无法打开 SFTP 会话通道: {e}")))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| AppError::Sftp(format!("请求 SFTP 子系统失败: {e}")))?;
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| AppError::Sftp(format!("初始化 SFTP 会话失败: {e}")))
}

/// 列出指定远程目录中的全部条目（目录优先并按名称排序）
pub async fn list_directory(
    handle: &Arc<russh::client::Handle<CandyClientHandler>>,
    path: &str,
) -> AppResult<SftpListResult> {
    let sftp = open_sftp_session(handle).await?;
    let target = if path.trim().is_empty() { "." } else { path };
    let resolved_path = sftp
        .canonicalize(target)
        .await
        .unwrap_or_else(|_| target.to_string());

    let dir_iter = sftp
        .read_dir(&resolved_path)
        .await
        .map_err(|e| AppError::Sftp(format!("读取远程目录失败: {e}")))?;

    let mut entries = Vec::new();
    for entry in dir_iter {
        let name = entry.file_name().to_string();
        let meta = entry.metadata();
        let file_type = entry.file_type();
        let is_dir = matches!(file_type, FileType::Dir) || meta.is_dir();
        let is_symlink = matches!(file_type, FileType::Symlink) || meta.is_symlink();
        let mode = meta.permissions.unwrap_or(0);
        entries.push(SftpEntry {
            path: join_remote_path(&resolved_path, &name),
            name,
            is_dir,
            is_symlink,
            size: meta.size.unwrap_or(0),
            permissions: format_unix_mode(mode, is_dir, is_symlink),
            modified_at: meta.mtime.map(|m| m as i64),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let _ = sftp.close().await;
    Ok(SftpListResult {
        resolved_path,
        entries,
    })
}

/// 流式上传本地文件到远程目录，并向前端实时推送传输进度事件
pub async fn upload_file(
    app: &AppHandle,
    session_id: &str,
    handle: &Arc<russh::client::Handle<CandyClientHandler>>,
    local_path: &str,
    remote_dir: &str,
) -> AppResult<String> {
    let local = Path::new(local_path);
    let file_name = local
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::InvalidInput("无效的本地文件路径".into()))?
        .to_string();

    let mut local_file = tokio::fs::File::open(local).await?;
    let total = local_file.metadata().await?.len();
    let remote_path = join_remote_path(remote_dir, &file_name);

    let sftp = open_sftp_session(handle).await?;
    let mut remote_file = sftp
        .open_with_flags(
            &remote_path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| AppError::Sftp(format!("打开远程目标文件失败: {e}")))?;

    let transfer_id = uuid::Uuid::new_v4().to_string();
    let mut buf = vec![0u8; 64 * 1024];
    let mut transferred: u64 = 0;

    loop {
        let n = local_file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        remote_file
            .write_all(&buf[..n])
            .await
            .map_err(|e| AppError::Sftp(format!("写入远程文件失败: {e}")))?;
        transferred += n as u64;

        let _ = app.emit(
            "sftp://progress",
            SftpTransferProgress {
                transfer_id: transfer_id.clone(),
                session_id: session_id.to_string(),
                file_name: file_name.clone(),
                direction: "upload".to_string(),
                transferred,
                total,
                done: false,
            },
        );
    }

    remote_file
        .shutdown()
        .await
        .map_err(|e| AppError::Sftp(format!("关闭远程文件句柄失败: {e}")))?;
    let _ = sftp.close().await;

    let _ = app.emit(
        "sftp://progress",
        SftpTransferProgress {
            transfer_id,
            session_id: session_id.to_string(),
            file_name,
            direction: "upload".to_string(),
            transferred: total,
            total,
            done: true,
        },
    );

    Ok(remote_path)
}

/// 流式下载远程文件到本地保存路径，并向前端实时推送传输进度事件
pub async fn download_file(
    app: &AppHandle,
    session_id: &str,
    handle: &Arc<russh::client::Handle<CandyClientHandler>>,
    remote_path: &str,
    local_path: &str,
) -> AppResult<()> {
    let sftp = open_sftp_session(handle).await?;
    let mut remote_file = sftp
        .open(remote_path)
        .await
        .map_err(|e| AppError::Sftp(format!("打开远程文件失败: {e}")))?;

    let total = remote_file
        .metadata()
        .await
        .ok()
        .and_then(|m| m.size)
        .unwrap_or(0);

    let file_name = remote_path
        .rsplit('/')
        .next()
        .unwrap_or("download")
        .to_string();

    let mut local_file = tokio::fs::File::create(local_path).await?;
    let transfer_id = uuid::Uuid::new_v4().to_string();
    let mut buf = vec![0u8; 64 * 1024];
    let mut transferred: u64 = 0;

    loop {
        let n = remote_file
            .read(&mut buf)
            .await
            .map_err(|e| AppError::Sftp(format!("读取远程文件失败: {e}")))?;
        if n == 0 {
            break;
        }
        local_file.write_all(&buf[..n]).await?;
        transferred += n as u64;

        let _ = app.emit(
            "sftp://progress",
            SftpTransferProgress {
                transfer_id: transfer_id.clone(),
                session_id: session_id.to_string(),
                file_name: file_name.clone(),
                direction: "download".to_string(),
                transferred,
                total,
                done: false,
            },
        );
    }

    local_file.flush().await?;
    let _ = remote_file.shutdown().await;
    let _ = sftp.close().await;

    let _ = app.emit(
        "sftp://progress",
        SftpTransferProgress {
            transfer_id,
            session_id: session_id.to_string(),
            file_name,
            direction: "download".to_string(),
            transferred,
            total: total.max(transferred),
            done: true,
        },
    );

    Ok(())
}

/// 创建远程目录
pub async fn create_dir(
    handle: &Arc<russh::client::Handle<CandyClientHandler>>,
    path: &str,
) -> AppResult<()> {
    let sftp = open_sftp_session(handle).await?;
    sftp.create_dir(path)
        .await
        .map_err(|e| AppError::Sftp(format!("创建目录失败: {e}")))?;
    let _ = sftp.close().await;
    Ok(())
}

/// 重命名或移动远程文件/目录
pub async fn rename_path(
    handle: &Arc<russh::client::Handle<CandyClientHandler>>,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    let sftp = open_sftp_session(handle).await?;
    sftp.rename(old_path, new_path)
        .await
        .map_err(|e| AppError::Sftp(format!("重命名失败: {e}")))?;
    let _ = sftp.close().await;
    Ok(())
}

/// 删除远程文件或空目录
pub async fn remove_entry(
    handle: &Arc<russh::client::Handle<CandyClientHandler>>,
    path: &str,
    is_dir: bool,
) -> AppResult<()> {
    let sftp = open_sftp_session(handle).await?;
    let res = if is_dir {
        sftp.remove_dir(path).await
    } else {
        sftp.remove_file(path).await
    };
    res.map_err(|e| AppError::Sftp(format!("删除失败: {e}")))?;
    let _ = sftp.close().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_join_remote_path() {
        assert_eq!(join_remote_path("/var/log", "nginx.log"), "/var/log/nginx.log");
        assert_eq!(join_remote_path("/var/log/", "/nginx.log"), "/var/log/nginx.log");
        assert_eq!(join_remote_path("/", "etc"), "/etc");
        assert_eq!(join_remote_path("", "home"), "/home");
    }

    #[test]
    fn test_format_unix_mode() {
        assert_eq!(format_unix_mode(0o755, true, false), "drwxr-xr-x");
        assert_eq!(format_unix_mode(0o644, false, false), "-rw-r--r--");
        assert_eq!(format_unix_mode(0o777, false, true), "lrwxrwxrwx");
    }
}
