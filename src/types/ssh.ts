/**
 * 主题模式：日间 / 夜间 / 跟随系统
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * 界面语言：简体中文 / 英文
 */
export type LocaleCode = 'zh-CN' | 'en-US';

/**
 * SSH 认证方式定义（与 Rust 后端 serde 标签对齐）
 */
export type AuthMethod =
  | { type: 'password'; password: string }
  | { type: 'privateKey'; privateKeyPath?: string; privateKeyContent?: string; passphrase?: string }
  | { type: 'agent' }
  | { type: 'keyboardInteractive'; password?: string };

/**
 * 代理 / 跳板机配置
 */
export type ProxyConfig =
  | { type: 'none' }
  | { type: 'socks5'; host: string; port: number; username?: string; password?: string }
  | { type: 'http'; host: string; port: number; username?: string; password?: string }
  | { type: 'jumpHost'; jumpHostId: string };

/**
 * 端口转发类型：本地转发(-L) / 远程转发(-R) / 动态SOCKS5(-D)
 */
export type ForwardType = 'local' | 'remote' | 'dynamic';

/**
 * 端口转发规则配置
 */
export interface PortForwardRule {
  id: string;
  name: string;
  forwardType: ForwardType;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  autoStart: boolean;
}

/**
 * 主机连接配置模型
 */
export interface HostProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  group: string;
  color: string;
  favorite: boolean;
  tags: string[];
  notes: string;
  auth: AuthMethod;
  proxy: ProxyConfig;
  forwards: PortForwardRule[];
  keepaliveIntervalSecs: number;
  lastConnectedAt?: number | null;
}

/**
 * 活动 SSH 会话状态
 */
export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * 活动端口转发运行状态
 */
export interface ActiveTunnel {
  ruleId: string;
  sessionId: string;
  name: string;
  forwardType: ForwardType;
  bindAddress: string;
  targetAddress: string;
  status: 'running' | 'stopped' | 'error';
  error?: string;
}

/**
 * SFTP 目录条目信息
 */
export interface SftpEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  permissions: string;
  modifiedAt?: number | null;
}

/**
 * SFTP 文件传输进度事件
 */
export interface SftpTransferProgress {
  transferId: string;
  sessionId: string;
  fileName: string;
  direction: 'upload' | 'download';
  transferred: number;
  total: number;
  done: boolean;
}

/**
 * 远程服务器实时监控指标
 */
export interface ServerMetrics {
  hostname: string;
  osName: string;
  kernel: string;
  uptimeSeconds: number;
  loadAvg: [number, number, number];
  cpuUsagePercent: number;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  diskTotalBytes: number;
  diskUsedBytes: number;
  collectedAt: number;
}

/**
 * 已知主机指纹记录
 */
export interface KnownHostEntry {
  hostPort: string;
  algorithm: string;
  fingerprint: string;
  trustedAt: number;
}

/**
 * 快捷命令片段
 */
export interface CommandSnippet {
  id: string;
  title: string;
  command: string;
  category: string;
  description?: string;
}

/**
 * 终端标签页会话实例
 */
export interface TerminalSession {
  id: string;
  hostId: string;
  title: string;
  hostAddress: string;
  username: string;
  color: string;
  status: SessionStatus;
  errorMessage?: string;
  sftpPath: string;
  sftpEntries: SftpEntry[];
  sftpLoading: boolean;
  metrics?: ServerMetrics | null;
  tunnels: ActiveTunnel[];
  createdAt: number;
}
