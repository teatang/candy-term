use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::models::{
    ActiveTunnel, CommandSnippet, HostProfile, KnownHostEntry, PortForwardRule, ServerMetrics,
    SftpListResult,
};
use crate::ssh::client::SshManager;
use crate::ssh::sftp;
use crate::storage::JsonStore;

/// Tauri 全局共享后端状态
pub struct AppState {
    pub store: JsonStore,
    pub ssh: Arc<SshManager>,
}

#[tauri::command]
pub async fn load_hosts(state: State<'_, AppState>) -> AppResult<Vec<HostProfile>> {
    state.store.load_hosts().await
}

#[tauri::command]
pub async fn save_hosts(state: State<'_, AppState>, hosts: Vec<HostProfile>) -> AppResult<()> {
    state.store.save_hosts(&hosts).await
}

#[tauri::command]
pub async fn load_snippets(state: State<'_, AppState>) -> AppResult<Vec<CommandSnippet>> {
    state.store.load_snippets().await
}

#[tauri::command]
pub async fn save_snippets(
    state: State<'_, AppState>,
    snippets: Vec<CommandSnippet>,
) -> AppResult<()> {
    state.store.save_snippets(&snippets).await
}

#[tauri::command]
pub async fn load_known_hosts(state: State<'_, AppState>) -> AppResult<Vec<KnownHostEntry>> {
    state.store.load_known_hosts().await
}

#[tauri::command]
pub async fn remove_known_host(state: State<'_, AppState>, host_port: String) -> AppResult<()> {
    state.store.remove_known_host(&host_port).await
}

#[tauri::command]
pub async fn ssh_test_connection(
    state: State<'_, AppState>,
    host: HostProfile,
    all_hosts: Vec<HostProfile>,
) -> AppResult<String> {
    state.ssh.test_connection(host, all_hosts).await
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    host: HostProfile,
    all_hosts: Vec<HostProfile>,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state
        .ssh
        .connect_session(app, session_id, host, all_hosts, cols, rows)
        .await
}

#[tauri::command]
pub async fn ssh_respond_host_key(
    state: State<'_, AppState>,
    challenge_id: String,
    trust: bool,
) -> AppResult<()> {
    state.ssh.respond_host_key_challenge(&challenge_id, trust).await
}

#[tauri::command]
pub async fn ssh_write_input(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    state.ssh.write_input(&session_id, &data).await
}

#[tauri::command]
pub async fn ssh_resize_pty(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state.ssh.resize_pty(&session_id, cols, rows).await
}

#[tauri::command]
pub async fn ssh_disconnect(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.ssh.disconnect(&session_id).await
}

#[tauri::command]
pub async fn sftp_list_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<SftpListResult> {
    let session = state.ssh.get_session(&session_id).await?;
    sftp::list_directory(&session.handle, &path).await
}

#[tauri::command]
pub async fn sftp_upload_file(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_dir: String,
) -> AppResult<String> {
    let session = state.ssh.get_session(&session_id).await?;
    sftp::upload_file(&app, &session_id, &session.handle, &local_path, &remote_dir).await
}

#[tauri::command]
pub async fn sftp_download_file(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> AppResult<()> {
    let session = state.ssh.get_session(&session_id).await?;
    sftp::download_file(&app, &session_id, &session.handle, &remote_path, &local_path).await
}

#[tauri::command]
pub async fn sftp_create_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<()> {
    let session = state.ssh.get_session(&session_id).await?;
    sftp::create_dir(&session.handle, &path).await
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> AppResult<()> {
    let session = state.ssh.get_session(&session_id).await?;
    sftp::rename_path(&session.handle, &old_path, &new_path).await
}

#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> AppResult<()> {
    let session = state.ssh.get_session(&session_id).await?;
    sftp::remove_entry(&session.handle, &path, is_dir).await
}

#[tauri::command]
pub async fn ssh_start_forward(
    state: State<'_, AppState>,
    session_id: String,
    rule: PortForwardRule,
) -> AppResult<ActiveTunnel> {
    state.ssh.start_forward(&session_id, rule).await
}

#[tauri::command]
pub async fn ssh_stop_forward(
    state: State<'_, AppState>,
    session_id: String,
    rule_id: String,
) -> AppResult<()> {
    state.ssh.stop_forward(&session_id, &rule_id).await
}

#[tauri::command]
pub async fn ssh_fetch_metrics(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<ServerMetrics> {
    state.ssh.fetch_metrics(&session_id).await
}
