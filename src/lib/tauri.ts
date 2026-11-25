import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import type {
  ActiveTunnel,
  CommandSnippet,
  HostProfile,
  KnownHostEntry,
  PortForwardRule,
  ServerMetrics,
  SftpEntry,
  SftpTransferProgress,
} from '@/types/ssh';

/**
 * 终端输出事件载荷
 */
export interface TerminalOutputPayload {
  sessionId: string;
  data: string;
}

/**
 * 会话状态变更事件载荷
 */
export interface SessionStatusPayload {
  sessionId: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  message?: string;
}

/**
 * 主机密钥指纹验证请求载荷
 */
export interface HostKeyChallengePayload {
  challengeId: string;
  sessionId: string;
  hostPort: string;
  algorithm: string;
  fingerprint: string;
  changed: boolean;
}

/**
 * 判断当前是否运行在 Tauri 桌面端内核环境中
 */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window &&
    Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
  );
}

/**
 * 调用后端 Tauri 命令的统一封装
 */
async function callBackend<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('TAURI_UNAVAILABLE');
  }
  return invoke<T>(command, args);
}

/**
 * Tauri 前后端 IPC 接口集合（含纯浏览器模式优雅降级）
 */
export const tauriApi = {
  async loadHosts(): Promise<HostProfile[]> {
    return callBackend<HostProfile[]>('load_hosts');
  },

  async saveHosts(hosts: HostProfile[]): Promise<void> {
    return callBackend<void>('save_hosts', { hosts });
  },

  async loadSnippets(): Promise<CommandSnippet[]> {
    return callBackend<CommandSnippet[]>('load_snippets');
  },

  async saveSnippets(snippets: CommandSnippet[]): Promise<void> {
    return callBackend<void>('save_snippets', { snippets });
  },

  async loadKnownHosts(): Promise<KnownHostEntry[]> {
    return callBackend<KnownHostEntry[]>('load_known_hosts');
  },

  async removeKnownHost(hostPort: string): Promise<void> {
    return callBackend<void>('remove_known_host', { hostPort });
  },

  async testConnection(host: HostProfile, allHosts: HostProfile[]): Promise<string> {
    return callBackend<string>('ssh_test_connection', { host, allHosts });
  },

  async connectSession(
    sessionId: string,
    host: HostProfile,
    allHosts: HostProfile[],
    cols: number,
    rows: number,
  ): Promise<void> {
    return callBackend<void>('ssh_connect', {
      sessionId,
      host,
      allHosts,
      cols,
      rows,
    });
  },

  async respondHostKeyChallenge(challengeId: string, trust: boolean): Promise<void> {
    return callBackend<void>('ssh_respond_host_key', { challengeId, trust });
  },

  async writeTerminal(sessionId: string, data: string): Promise<void> {
    return callBackend<void>('ssh_write_input', { sessionId, data });
  },

  async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
    return callBackend<void>('ssh_resize_pty', { sessionId, cols, rows });
  },

  async disconnectSession(sessionId: string): Promise<void> {
    return callBackend<void>('ssh_disconnect', { sessionId });
  },

  async sftpListDir(sessionId: string, path: string): Promise<{ resolvedPath: string; entries: SftpEntry[] }> {
    return callBackend<{ resolvedPath: string; entries: SftpEntry[] }>('sftp_list_dir', {
      sessionId,
      path,
    });
  },

  async sftpUploadFile(
    sessionId: string,
    localPath: string,
    remoteDir: string,
  ): Promise<string> {
    return callBackend<string>('sftp_upload_file', {
      sessionId,
      localPath,
      remoteDir,
    });
  },

  async sftpDownloadFile(
    sessionId: string,
    remotePath: string,
    localPath: string,
  ): Promise<void> {
    return callBackend<void>('sftp_download_file', {
      sessionId,
      remotePath,
      localPath,
    });
  },

  async sftpCreateDir(sessionId: string, path: string): Promise<void> {
    return callBackend<void>('sftp_create_dir', { sessionId, path });
  },

  async sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    return callBackend<void>('sftp_rename', { sessionId, oldPath, newPath });
  },

  async sftpRemove(sessionId: string, path: string, isDir: boolean): Promise<void> {
    return callBackend<void>('sftp_remove', { sessionId, path, isDir });
  },

  async startPortForward(sessionId: string, rule: PortForwardRule): Promise<ActiveTunnel> {
    return callBackend<ActiveTunnel>('ssh_start_forward', { sessionId, rule });
  },

  async stopPortForward(sessionId: string, ruleId: string): Promise<void> {
    return callBackend<void>('ssh_stop_forward', { sessionId, ruleId });
  },

  async fetchServerMetrics(sessionId: string): Promise<ServerMetrics> {
    return callBackend<ServerMetrics>('ssh_fetch_metrics', { sessionId });
  },

  async pickLocalFiles(): Promise<string[]> {
    if (!isTauriRuntime()) return [];
    const selected = await open({ multiple: true });
    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
  },

  async pickSingleFile(): Promise<string | null> {
    if (!isTauriRuntime()) return null;
    const selected = await open({ multiple: false });
    if (!selected) return null;
    return Array.isArray(selected) ? selected[0] ?? null : selected;
  },

  async pickSavePath(defaultName: string): Promise<string | null> {
    if (!isTauriRuntime()) return null;
    return save({ defaultPath: defaultName });
  },

  async onTerminalOutput(handler: (payload: TerminalOutputPayload) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<TerminalOutputPayload>('ssh://output', (event) => handler(event.payload));
  },

  async onSessionStatus(handler: (payload: SessionStatusPayload) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<SessionStatusPayload>('ssh://status', (event) => handler(event.payload));
  },

  async onHostKeyChallenge(handler: (payload: HostKeyChallengePayload) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<HostKeyChallengePayload>('ssh://host-key-challenge', (event) => handler(event.payload));
  },

  async onSftpProgress(handler: (payload: SftpTransferProgress) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<SftpTransferProgress>('sftp://progress', (event) => handler(event.payload));
  },
};
