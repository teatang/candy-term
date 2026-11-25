use base64::Engine;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::error::{AppError, AppResult};

/// 通过 SOCKS5 代理服务器建立到目标主机的 TCP 隧道（支持无认证与用户名/密码认证）
pub async fn connect_via_socks5(
    proxy_host: &str,
    proxy_port: u16,
    target_host: &str,
    target_port: u16,
    username: Option<&str>,
    password: Option<&str>,
) -> AppResult<TcpStream> {
    let stream = TcpStream::connect((proxy_host, proxy_port))
        .await
        .map_err(|e| AppError::Proxy(format!("连接 SOCKS5 代理失败: {e}")))?;
    socks5_handshake(stream, target_host, target_port, username, password).await
}

/// 在任意异步双向流上执行 RFC 1928 / RFC 1929 SOCKS5 握手协议
pub async fn socks5_handshake<S>(
    mut stream: S,
    target_host: &str,
    target_port: u16,
    username: Option<&str>,
    password: Option<&str>,
) -> AppResult<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let has_auth = username.is_some_and(|u| !u.is_empty()) && password.is_some();
    // 1. 发送版本与认证方法协商包
    let greeting = if has_auth {
        vec![0x05, 0x02, 0x00, 0x02]
    } else {
        vec![0x05, 0x01, 0x00]
    };
    stream
        .write_all(&greeting)
        .await
        .map_err(|e| AppError::Proxy(format!("SOCKS5 握手发送失败: {e}")))?;

    let mut method_resp = [0u8; 2];
    stream
        .read_exact(&mut method_resp)
        .await
        .map_err(|e| AppError::Proxy(format!("SOCKS5 握手读取失败: {e}")))?;

    if method_resp[0] != 0x05 {
        return Err(AppError::Proxy("无效的 SOCKS5 协议版本响应".into()));
    }

    match method_resp[1] {
        0x00 => {}
        0x02 => {
            let user = username.unwrap_or_default().as_bytes();
            let pass = password.unwrap_or_default().as_bytes();
            if user.len() > 255 || pass.len() > 255 {
                return Err(AppError::Proxy("SOCKS5 用户名或密码过长".into()));
            }
            let mut auth_req = Vec::with_capacity(3 + user.len() + pass.len());
            auth_req.push(0x01);
            auth_req.push(user.len() as u8);
            auth_req.extend_from_slice(user);
            auth_req.push(pass.len() as u8);
            auth_req.extend_from_slice(pass);
            stream
                .write_all(&auth_req)
                .await
                .map_err(|e| AppError::Proxy(format!("SOCKS5 认证发送失败: {e}")))?;

            let mut auth_resp = [0u8; 2];
            stream
                .read_exact(&mut auth_resp)
                .await
                .map_err(|e| AppError::Proxy(format!("SOCKS5 认证响应读取失败: {e}")))?;
            if auth_resp[1] != 0x00 {
                return Err(AppError::Proxy("SOCKS5 代理用户名或密码错误".into()));
            }
        }
        _ => return Err(AppError::Proxy("SOCKS5 代理拒绝了客户端支持的认证方式".into())),
    }

    // 2. 发送 CONNECT 目标地址请求（域名模式 ATYP=0x03）
    let host_bytes = target_host.as_bytes();
    if host_bytes.len() > 255 {
        return Err(AppError::Proxy("目标主机名过长".into()));
    }
    let mut connect_req = Vec::with_capacity(7 + host_bytes.len());
    connect_req.extend_from_slice(&[0x05, 0x01, 0x00, 0x03, host_bytes.len() as u8]);
    connect_req.extend_from_slice(host_bytes);
    connect_req.extend_from_slice(&target_port.to_be_bytes());
    stream
        .write_all(&connect_req)
        .await
        .map_err(|e| AppError::Proxy(format!("SOCKS5 CONNECT 请求发送失败: {e}")))?;

    // 3. 解析代理响应头与绑定地址
    let mut head = [0u8; 4];
    stream
        .read_exact(&mut head)
        .await
        .map_err(|e| AppError::Proxy(format!("SOCKS5 CONNECT 响应读取失败: {e}")))?;
    if head[0] != 0x05 || head[1] != 0x00 {
        return Err(AppError::Proxy(format!(
            "SOCKS5 代理建连失败，错误码: 0x{:02x}",
            head[1]
        )));
    }

    match head[3] {
        0x01 => {
            let mut rest = [0u8; 6];
            stream.read_exact(&mut rest).await.map_err(|e| AppError::Proxy(e.to_string()))?;
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await.map_err(|e| AppError::Proxy(e.to_string()))?;
            let mut rest = vec![0u8; len[0] as usize + 2];
            stream.read_exact(&mut rest).await.map_err(|e| AppError::Proxy(e.to_string()))?;
        }
        0x04 => {
            let mut rest = [0u8; 18];
            stream.read_exact(&mut rest).await.map_err(|e| AppError::Proxy(e.to_string()))?;
        }
        other => {
            return Err(AppError::Proxy(format!("未知 SOCKS5 地址类型: {other}")));
        }
    }

    Ok(stream)
}

/// 通过 HTTP CONNECT 代理建立到目标主机的隧道
pub async fn connect_via_http(
    proxy_host: &str,
    proxy_port: u16,
    target_host: &str,
    target_port: u16,
    username: Option<&str>,
    password: Option<&str>,
) -> AppResult<TcpStream> {
    let stream = TcpStream::connect((proxy_host, proxy_port))
        .await
        .map_err(|e| AppError::Proxy(format!("连接 HTTP 代理失败: {e}")))?;
    http_connect_handshake(stream, target_host, target_port, username, password).await
}

/// 在任意异步双向流上执行 HTTP CONNECT 隧道握手
pub async fn http_connect_handshake<S>(
    mut stream: S,
    target_host: &str,
    target_port: u16,
    username: Option<&str>,
    password: Option<&str>,
) -> AppResult<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let req = build_http_connect_request(target_host, target_port, username, password);
    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| AppError::Proxy(format!("发送 HTTP CONNECT 请求失败: {e}")))?;

    // 逐字节读取直到遇到空行 "\r\n\r\n"，避免预读穿透后续 SSH 握手字节流
    let mut buf = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    loop {
        let n = stream
            .read(&mut byte)
            .await
            .map_err(|e| AppError::Proxy(format!("读取 HTTP 代理响应失败: {e}")))?;
        if n == 0 {
            return Err(AppError::Proxy("HTTP 代理意外关闭连接".into()));
        }
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
        if buf.len() > 8192 {
            return Err(AppError::Proxy("HTTP 代理响应头过大".into()));
        }
    }

    let header_str = String::from_utf8_lossy(&buf);
    let status_line = header_str.lines().next().unwrap_or_default();
    if !status_line.contains(" 200 ") {
        return Err(AppError::Proxy(format!("HTTP 代理建连失败: {status_line}")));
    }

    Ok(stream)
}

/// 构造 HTTP CONNECT 请求报文
pub fn build_http_connect_request(
    target_host: &str,
    target_port: u16,
    username: Option<&str>,
    password: Option<&str>,
) -> String {
    let target = format!("{target_host}:{target_port}");
    let mut req = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if let Some(user) = username {
        if !user.is_empty() {
            let creds = format!("{user}:{}", password.unwrap_or_default());
            let encoded = base64::engine::general_purpose::STANDARD.encode(creds.as_bytes());
            req.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
        }
    }
    req.push_str("\r\n");
    req
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_http_connect_request_with_auth() {
        let req = build_http_connect_request("example.com", 22, Some("alice"), Some("s3cr3t"));
        assert!(req.starts_with("CONNECT example.com:22 HTTP/1.1\r\n"));
        assert!(req.contains("Proxy-Authorization: Basic "));
        assert!(req.ends_with("\r\n\r\n"));
    }

    #[tokio::test]
    async fn test_http_connect_handshake_success_and_error() {
        let (client_stream, mut server_stream) = tokio::io::duplex(1024);

        tokio::spawn(async move {
            let mut buf = [0u8; 256];
            let n = server_stream.read(&mut buf).await.unwrap();
            let req = String::from_utf8_lossy(&buf[..n]);
            assert!(req.contains("CONNECT remote.internal:22 HTTP/1.1"));
            server_stream
                .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\nSSH-2.0-Mock")
                .await
                .unwrap();
        });

        let mut stream = http_connect_handshake(client_stream, "remote.internal", 22, None, None)
            .await
            .unwrap();
        let mut banner = [0u8; 12];
        stream.read_exact(&mut banner).await.unwrap();
        assert_eq!(&banner, b"SSH-2.0-Mock");

        // 测试非 200 错误状态码
        let (c2, mut s2) = tokio::io::duplex(512);
        tokio::spawn(async move {
            let mut buf = [0u8; 256];
            let _ = s2.read(&mut buf).await.unwrap();
            s2.write_all(b"HTTP/1.1 407 Proxy Auth Required\r\n\r\n").await.unwrap();
        });
        assert!(http_connect_handshake(c2, "remote.internal", 22, None, None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn test_socks5_handshake_with_username_password() {
        let (client_stream, mut server_stream) = tokio::io::duplex(1024);

        tokio::spawn(async move {
            let mut greet = [0u8; 4];
            server_stream.read_exact(&mut greet).await.unwrap();
            assert_eq!(greet, [0x05, 0x02, 0x00, 0x02]);
            // 选择用户名密码认证 0x02
            server_stream.write_all(&[0x05, 0x02]).await.unwrap();

            let mut auth_head = [0u8; 2];
            server_stream.read_exact(&mut auth_head).await.unwrap();
            assert_eq!(auth_head[0], 0x01);
            let mut user = vec![0u8; auth_head[1] as usize];
            server_stream.read_exact(&mut user).await.unwrap();
            assert_eq!(&user, b"dev");
            let mut plen = [0u8; 1];
            server_stream.read_exact(&mut plen).await.unwrap();
            let mut pass = vec![0u8; plen[0] as usize];
            server_stream.read_exact(&mut pass).await.unwrap();
            assert_eq!(&pass, b"pass");
            server_stream.write_all(&[0x01, 0x00]).await.unwrap();

            let mut req_head = [0u8; 5];
            server_stream.read_exact(&mut req_head).await.unwrap();
            assert_eq!(&req_head[..4], &[0x05, 0x01, 0x00, 0x03]);
            let len = req_head[4] as usize;
            let mut rest = vec![0u8; len + 2];
            server_stream.read_exact(&mut rest).await.unwrap();
            assert_eq!(&rest[..len], b"db.internal");

            server_stream
                .write_all(&[0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 22])
                .await
                .unwrap();
            server_stream.write_all(b"OK").await.unwrap();
        });

        let mut stream =
            socks5_handshake(client_stream, "db.internal", 22, Some("dev"), Some("pass"))
                .await
                .unwrap();
        let mut ok = [0u8; 2];
        stream.read_exact(&mut ok).await.unwrap();
        assert_eq!(&ok, b"OK");
    }
}
