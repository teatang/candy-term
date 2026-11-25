import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  isTauriRuntime,
  tauriApi,
  type HostKeyChallengePayload,
} from '@/lib/tauri';
import type {
  ActiveTunnel,
  HostProfile,
  KnownHostEntry,
  PortForwardRule,
  SftpTransferProgress,
  TerminalSession,
} from '@/types/ssh';

// 终端输出回调函数注册表（sessionId -> 写入 xterm 实例的回调）
type OutputSink = (chunk: string) => void;

/**
 * SSH 会话、SFTP、端口转发与主机指纹验证状态 Store
 */
export const useSessionStore = defineStore('sessions', () => {
  const sessions = ref<TerminalSession[]>([]);
  const activeSessionId = ref<string | null>(null);
  const pendingChallenge = ref<HostKeyChallengePayload | null>(null);
  const knownHosts = ref<KnownHostEntry[]>([]);
  const activeTransfer = ref<SftpTransferProgress | null>(null);

  const outputSinks = new Map<string, OutputSink>();
  const bufferedOutputs = new Map<string, string[]>();
  let listenersInitialized = false;

  /**
   * 当前聚焦的活动终端会话
   */
  const activeSession = computed<TerminalSession | null>(
    () => sessions.value.find((s) => s.id === activeSessionId.value) ?? null,
  );

  /**
   * 初始化来自 Rust 后端的实时事件监听（终端流、状态、主机指纹验证、SFTP进度）
   */
  async function initEventListeners(): Promise<void> {
    if (listenersInitialized) return;
    listenersInitialized = true;

    await tauriApi.onTerminalOutput(({ sessionId, data }) => {
      const sink = outputSinks.get(sessionId);
      if (sink) {
        sink(data);
      } else {
        const list = bufferedOutputs.get(sessionId) ?? [];
        list.push(data);
        bufferedOutputs.set(sessionId, list);
      }
    });

    await tauriApi.onSessionStatus(({ sessionId, status, message }) => {
      const target = sessions.value.find((s) => s.id === sessionId);
      if (target) {
        target.status = status;
        target.errorMessage = message;
      }
    });

    await tauriApi.onHostKeyChallenge((payload) => {
      pendingChallenge.value = payload;
    });

    await tauriApi.onSftpProgress((progress) => {
      activeTransfer.value = progress.done ? null : progress;
    });
  }

  /**
   * 绑定 xterm 输出消费回调，并立即回放连接早期缓冲输出
   */
  function registerOutputSink(sessionId: string, sink: OutputSink): void {
    outputSinks.set(sessionId, sink);
    const pending = bufferedOutputs.get(sessionId);
    if (pending && pending.length > 0) {
      for (const chunk of pending) {
        sink(chunk);
      }
      bufferedOutputs.delete(sessionId);
    }
  }

  function unregisterOutputSink(sessionId: string): void {
    outputSinks.delete(sessionId);
  }

  /**
   * 基于主机配置新建并建立 SSH 终端会话
   */
  async function openSession(
    host: HostProfile,
    allHosts: HostProfile[],
    cols = 100,
    rows = 30,
  ): Promise<TerminalSession> {
    await initEventListeners();
    const sessionId = crypto.randomUUID();
    const session: TerminalSession = {
      id: sessionId,
      hostId: host.id,
      title: host.name || `${host.username}@${host.host}`,
      hostAddress: `${host.host}:${host.port}`,
      username: host.username,
      color: host.color,
      status: 'connecting',
      sftpPath: '.',
      sftpEntries: [],
      sftpLoading: false,
      metrics: null,
      tunnels: [],
      createdAt: Date.now(),
    };

    sessions.value.push(session);
    activeSessionId.value = sessionId;

    if (!isTauriRuntime()) {
      // 纯浏览器预览模式下的友好演示终端回显
      session.status = 'connected';
      const welcome =
        `\r\n\x1b[38;5;212m🍬 candy-term preview shell\x1b[0m (${host.username}@${host.host}:${host.port})\r\n` +
        `\x1b[90mNote: Browser preview mode active. Launch via \`pnpm tauri dev\` for native Rust SSH/SFTP.\x1b[0m\r\n\r\n` +
        `${host.username}@${host.host}:~$ `;
      const sink = outputSinks.get(sessionId);
      if (sink) {
        sink(welcome);
      } else {
        bufferedOutputs.set(sessionId, [welcome]);
      }
      return session;
    }

    try {
      await tauriApi.connectSession(sessionId, host, allHosts, cols, rows);
      session.status = 'connected';

      // 自动拉起配置为自启动的端口转发规则
      for (const rule of host.forwards.filter((f) => f.autoStart)) {
        try {
          const tunnel = await tauriApi.startPortForward(sessionId, rule);
          session.tunnels.push(tunnel);
        } catch (err) {
          session.tunnels.push({
            ruleId: rule.id,
            sessionId,
            name: rule.name,
            forwardType: rule.forwardType,
            bindAddress: `${rule.localHost}:${rule.localPort}`,
            targetAddress: `${rule.remoteHost}:${rule.remotePort}`,
            status: 'error',
            error: String(err),
          });
        }
      }
    } catch (err) {
      session.status = 'error';
      session.errorMessage = String(err);
    }

    return session;
  }

  /**
   * 发送终端按键输入
   */
  async function sendInput(sessionId: string, data: string): Promise<void> {
    if (!isTauriRuntime()) {
      const sink = outputSinks.get(sessionId);
      if (sink) {
        if (data === '\r') {
          sink('\r\n$ ');
        } else if (data === '\x7f') {
          sink('\b \b');
        } else {
          sink(data);
        }
      }
      return;
    }
    await tauriApi.writeTerminal(sessionId, data);
  }

  /**
   * 广播命令到所有已连接的活动终端
   */
  async function broadcastCommand(command: string): Promise<number> {
    const targets = sessions.value.filter((s) => s.status === 'connected');
    for (const s of targets) {
      await sendInput(s.id, `${command}\n`);
    }
    return targets.length;
  }

  /**
   * 同步终端窗口尺寸到远程 PTY
   */
  async function resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    if (!isTauriRuntime()) return;
    const session = sessions.value.find((s) => s.id === sessionId);
    if (!session || session.status !== 'connected') return;
    await tauriApi.resizeTerminal(sessionId, cols, rows);
  }

  /**
   * 关闭指定终端会话并清理后端通道
   */
  async function closeSession(sessionId: string): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await tauriApi.disconnectSession(sessionId);
      } catch {
        // 忽略已断开会话的关闭异常
      }
    }
    outputSinks.delete(sessionId);
    bufferedOutputs.delete(sessionId);
    const idx = sessions.value.findIndex((s) => s.id === sessionId);
    if (idx >= 0) {
      sessions.value.splice(idx, 1);
    }
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[Math.max(0, idx - 1)]?.id ?? null;
    }
  }

  /**
   * 响应服务器主机指纹验证弹窗
   */
  async function resolveHostKeyChallenge(trust: boolean): Promise<void> {
    if (!pendingChallenge.value) return;
    const challengeId = pendingChallenge.value.challengeId;
    pendingChallenge.value = null;
    await tauriApi.respondHostKeyChallenge(challengeId, trust);
    if (trust) {
      await loadKnownHosts();
    }
  }

  /**
   * 刷新当前会话 SFTP 目录列表
   */
  async function refreshSftp(sessionId: string, path?: string): Promise<void> {
    const session = sessions.value.find((s) => s.id === sessionId);
    if (!session || session.status !== 'connected' || !isTauriRuntime()) return;

    session.sftpLoading = true;
    try {
      const targetPath = path ?? session.sftpPath ?? '.';
      const result = await tauriApi.sftpListDir(sessionId, targetPath);
      session.sftpPath = result.resolvedPath;
      session.sftpEntries = result.entries;
    } finally {
      session.sftpLoading = false;
    }
  }

  /**
   * 启动单条端口转发规则
   */
  async function startForward(sessionId: string, rule: PortForwardRule): Promise<ActiveTunnel> {
    const tunnel = await tauriApi.startPortForward(sessionId, rule);
    const session = sessions.value.find((s) => s.id === sessionId);
    if (session) {
      const idx = session.tunnels.findIndex((t) => t.ruleId === rule.id);
      if (idx >= 0) {
        session.tunnels[idx] = tunnel;
      } else {
        session.tunnels.push(tunnel);
      }
    }
    return tunnel;
  }

  /**
   * 停止单条端口转发规则
   */
  async function stopForward(sessionId: string, ruleId: string): Promise<void> {
    await tauriApi.stopPortForward(sessionId, ruleId);
    const session = sessions.value.find((s) => s.id === sessionId);
    if (session) {
      session.tunnels = session.tunnels.filter((t) => t.ruleId !== ruleId);
    }
  }

  /**
   * 采集当前会话远程服务器状态指标
   */
  async function refreshMetrics(sessionId: string): Promise<void> {
    const session = sessions.value.find((s) => s.id === sessionId);
    if (!session || session.status !== 'connected' || !isTauriRuntime()) return;
    session.metrics = await tauriApi.fetchServerMetrics(sessionId);
  }

  /**
   * 加载已知信任主机列表
   */
  async function loadKnownHosts(): Promise<void> {
    if (!isTauriRuntime()) {
      knownHosts.value = [];
      return;
    }
    knownHosts.value = await tauriApi.loadKnownHosts();
  }

  /**
   * 移除已信任主机指纹
   */
  async function removeKnownHost(hostPort: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await tauriApi.removeKnownHost(hostPort);
    knownHosts.value = knownHosts.value.filter((k) => k.hostPort !== hostPort);
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    pendingChallenge,
    knownHosts,
    activeTransfer,
    initEventListeners,
    registerOutputSink,
    unregisterOutputSink,
    openSession,
    sendInput,
    broadcastCommand,
    resizeSession,
    closeSession,
    resolveHostKeyChallenge,
    refreshSftp,
    startForward,
    stopForward,
    refreshMetrics,
    loadKnownHosts,
    removeKnownHost,
  };
});
