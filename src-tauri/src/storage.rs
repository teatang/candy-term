use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::AppResult;
use crate::models::{CommandSnippet, HostProfile, KnownHostEntry};

/// 本地 JSON 持久化存储管理器，负责保存主机配置、快捷指令与信任主机指纹
#[derive(Clone)]
pub struct JsonStore {
    base_dir: PathBuf,
    io_lock: Arc<RwLock<()>>,
}

/// 主机密钥检查结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyStatus {
    /// 与本地记录完全匹配，自动放行
    Trusted,
    /// 本地尚未记录该主机
    Unknown,
    /// 主机指纹发生变更（需用户高度警惕并确认）
    Changed { previous_fingerprint: String },
}

impl JsonStore {
    /// 创建持久化存储实例（自动确保数据目录存在）
    pub fn new<P: AsRef<Path>>(base_dir: P) -> AppResult<Self> {
        let dir = base_dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir)?;
        Ok(Self {
            base_dir: dir,
            io_lock: Arc::new(RwLock::new(())),
        })
    }

    fn hosts_path(&self) -> PathBuf {
        self.base_dir.join("hosts.json")
    }

    fn snippets_path(&self) -> PathBuf {
        self.base_dir.join("snippets.json")
    }

    fn known_hosts_path(&self) -> PathBuf {
        self.base_dir.join("known_hosts.json")
    }

    /// 原子读取 JSON 数组文件（文件不存在时返回空列表）
    async fn read_vec<T: serde::de::DeserializeOwned>(&self, path: &Path) -> AppResult<Vec<T>> {
        let _guard = self.io_lock.read().await;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content = fs::read_to_string(path)?;
        if content.trim().is_empty() {
            return Ok(Vec::new());
        }
        Ok(serde_json::from_str(&content)?)
    }

    /// 通过临时文件写入并重命名，实现防损坏的原子持久化
    async fn write_vec<T: serde::Serialize>(&self, path: &Path, items: &[T]) -> AppResult<()> {
        let _guard = self.io_lock.write().await;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(items)?;
        let tmp_path = path.with_extension("json.tmp");
        fs::write(&tmp_path, json)?;
        fs::rename(&tmp_path, path)?;
        Ok(())
    }

    pub async fn load_hosts(&self) -> AppResult<Vec<HostProfile>> {
        self.read_vec(&self.hosts_path()).await
    }

    pub async fn save_hosts(&self, hosts: &[HostProfile]) -> AppResult<()> {
        self.write_vec(&self.hosts_path(), hosts).await
    }

    pub async fn load_snippets(&self) -> AppResult<Vec<CommandSnippet>> {
        self.read_vec(&self.snippets_path()).await
    }

    pub async fn save_snippets(&self, snippets: &[CommandSnippet]) -> AppResult<()> {
        self.write_vec(&self.snippets_path(), snippets).await
    }

    pub async fn load_known_hosts(&self) -> AppResult<Vec<KnownHostEntry>> {
        self.read_vec(&self.known_hosts_path()).await
    }

    /// 检查给定主机端口和 SHA-256 指纹是否已被信任
    pub async fn check_host_key(&self, host_port: &str, fingerprint: &str) -> AppResult<HostKeyStatus> {
        let entries = self.load_known_hosts().await?;
        match entries.into_iter().find(|e| e.host_port == host_port) {
            None => Ok(HostKeyStatus::Unknown),
            Some(entry) if entry.fingerprint == fingerprint => Ok(HostKeyStatus::Trusted),
            Some(entry) => Ok(HostKeyStatus::Changed {
                previous_fingerprint: entry.fingerprint,
            }),
        }
    }

    /// 添加或更新受信任主机指纹记录
    pub async fn trust_host_key(
        &self,
        host_port: String,
        algorithm: String,
        fingerprint: String,
    ) -> AppResult<()> {
        let mut entries = self.load_known_hosts().await?;
        let now = chrono::Utc::now().timestamp();
        if let Some(existing) = entries.iter_mut().find(|e| e.host_port == host_port) {
            existing.algorithm = algorithm;
            existing.fingerprint = fingerprint;
            existing.trusted_at = now;
        } else {
            entries.push(KnownHostEntry {
                host_port,
                algorithm,
                fingerprint,
                trusted_at: now,
            });
        }
        self.write_vec(&self.known_hosts_path(), &entries).await
    }

    /// 从已知主机列表中移除指定主机的信任记录
    pub async fn remove_known_host(&self, host_port: &str) -> AppResult<()> {
        let mut entries = self.load_known_hosts().await?;
        entries.retain(|e| e.host_port != host_port);
        self.write_vec(&self.known_hosts_path(), &entries).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AuthMethod, ProxyConfig};
    use tempfile::TempDir;

    fn sample_host(id: &str, name: &str) -> HostProfile {
        HostProfile {
            id: id.to_string(),
            name: name.to_string(),
            host: "10.0.0.5".to_string(),
            port: 22,
            username: "deploy".to_string(),
            group: "Production".to_string(),
            color: "#ec4899".to_string(),
            favorite: true,
            tags: vec!["linux".to_string(), "web".to_string()],
            notes: "测试节点".to_string(),
            auth: AuthMethod::Password {
                password: "secret".to_string(),
            },
            proxy: ProxyConfig::None,
            forwards: vec![],
            keepalive_interval_secs: 30,
            last_connected_at: None,
        }
    }

    #[tokio::test]
    async fn test_hosts_roundtrip_persistence() {
        let dir = TempDir::new().unwrap();
        let store = JsonStore::new(dir.path()).unwrap();

        assert!(store.load_hosts().await.unwrap().is_empty());

        let hosts = vec![sample_host("h1", "Web Node 1")];
        store.save_hosts(&hosts).await.unwrap();

        let loaded = store.load_hosts().await.unwrap();
        assert_eq!(loaded, hosts);
    }

    #[tokio::test]
    async fn test_known_host_lifecycle() {
        let dir = TempDir::new().unwrap();
        let store = JsonStore::new(dir.path()).unwrap();

        let status = store
            .check_host_key("192.168.1.1:22", "SHA256:abc")
            .await
            .unwrap();
        assert_eq!(status, HostKeyStatus::Unknown);

        store
            .trust_host_key(
                "192.168.1.1:22".to_string(),
                "ssh-ed25519".to_string(),
                "SHA256:abc".to_string(),
            )
            .await
            .unwrap();

        assert_eq!(
            store
                .check_host_key("192.168.1.1:22", "SHA256:abc")
                .await
                .unwrap(),
            HostKeyStatus::Trusted
        );

        assert_eq!(
            store
                .check_host_key("192.168.1.1:22", "SHA256:xyz")
                .await
                .unwrap(),
            HostKeyStatus::Changed {
                previous_fingerprint: "SHA256:abc".to_string()
            }
        );

        store.remove_known_host("192.168.1.1:22").await.unwrap();
        assert_eq!(
            store
                .check_host_key("192.168.1.1:22", "SHA256:abc")
                .await
                .unwrap(),
            HostKeyStatus::Unknown
        );
    }
}
