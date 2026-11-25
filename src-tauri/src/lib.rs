// candy-term / 糖果终端 Rust 核心库模块
pub mod commands;
pub mod error;
pub mod models;
pub mod ssh;
pub mod storage;

use std::sync::Arc;
use tauri::Manager;

use commands::AppState;
use ssh::client::SshManager;
use storage::JsonStore;

/// 初始化 Tauri 运行时、插件、持久化存储与全部 IPC 命令
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("candy-term"));
            let store = JsonStore::new(data_dir)?;
            let ssh = Arc::new(SshManager::new(store.clone()));
            app.manage(AppState { store, ssh });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_hosts,
            commands::save_hosts,
            commands::load_snippets,
            commands::save_snippets,
            commands::load_known_hosts,
            commands::remove_known_host,
            commands::ssh_test_connection,
            commands::ssh_connect,
            commands::ssh_respond_host_key,
            commands::ssh_write_input,
            commands::ssh_resize_pty,
            commands::ssh_disconnect,
            commands::sftp_list_dir,
            commands::sftp_upload_file,
            commands::sftp_download_file,
            commands::sftp_create_dir,
            commands::sftp_rename,
            commands::sftp_remove,
            commands::ssh_start_forward,
            commands::ssh_stop_forward,
            commands::ssh_fetch_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("启动 candy-term Tauri 应用失败");
}
