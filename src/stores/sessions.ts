import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  isTauriRuntime,
  tauriApi,
  type HostKeyChallengePayload,
} from '@/lib/tauri';
import {
  collectLeaves,
  createLeafNode,
  findLeafByPaneId,
  findLeafBySessionId,
  removeLeafNode,
  splitLeafNode,
  updateSplitRatio,
  type SplitDirection,
  type SplitNode,
} from '@/lib/splitLayout';
import { cloneHostProfile } from '@/stores/hosts';
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
 * 终端标签页（内含可无限嵌套的二叉树分屏布局）
 */
export interface TerminalTab {
  id: string;
  title: string;
  layout: SplitNode;
  focusedPaneId: string;
}

/**
 * SSH 会话、分屏标签页、SFTP、端口转发与主机指纹验证状态 Store
 */
export const useSessionStore = defineStore('sessions', () => {
  const sessions = ref<TerminalSession[]>([]);
  const tabs = ref<TerminalTab[]>([]);
  const activeTabId = ref<string | null>(null);
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
   * 当前聚焦的活动标签页
   */
  const activeTab = computed<TerminalTab | null>(
    () => tabs.value.find((t) => t.id === activeTabId.value) ?? null,
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

  function emitOutputChunk(sessionId: string, chunk: string): void {
    const sink = outputSinks.get(sessionId);
    if (sink) {
      sink(chunk);
    } else {
      const list = bufferedOutputs.get(sessionId) ?? [];
      list.push(chunk);
      bufferedOutputs.set(sessionId, list);
    }
  }

  /**
   * 建立单个 SSH 会话连接（供新标签与分屏共用）
   */
  async function establishConnection(
    session: TerminalSession,
    host: HostProfile,
    allHosts: HostProfile[],
    cols: number,
    rows: number,
    autoStartForwards: boolean,
  ): Promise<void> {
    if (!isTauriRuntime()) {
      session.status = 'connected';
      const welcome =
        `\r\n\x1b[38;5;212m🍬 candy-term preview shell\x1b[0m (${host.username}@${host.host}:${host.port})\r\n` +
        `\x1b[90mNote: Browser preview mode active. Launch via \`pnpm tauri dev\` for native Rust SSH/SFTP.\x1b[0m\r\n\r\n` +
        `${host.username}@${host.host}:~$ `;
      emitOutputChunk(session.id, welcome);
      return;
    }

    try {
      await tauriApi.connectSession(session.id, host, allHosts, cols, rows);
      session.status = 'connected';

      if (autoStartForwards) {
        for (const rule of host.forwards.filter((f) => f.autoStart)) {
          try {
            const tunnel = await tauriApi.startPortForward(session.id, rule);
            session.tunnels.push(tunnel);
          } catch (err) {
            session.tunnels.push({
              ruleId: rule.id,
              sessionId: session.id,
              name: rule.name,
              forwardType: rule.forwardType,
              bindAddress: `${rule.localHost}:${rule.localPort}`,
              targetAddress: `${rule.remoteHost}:${rule.remotePort}`,
              status: 'error',
              error: String(err),
            });
          }
        }
      }
    } catch (err) {
      session.status = 'error';
      session.errorMessage = String(err);
    }
  }

  function createSessionObject(host: HostProfile): TerminalSession {
    return {
      id: crypto.randomUUID(),
      hostId: host.id,
      hostSnapshot: cloneHostProfile(host),
      title: host.name || `${host.username}@${host.host}`,
      hostAddress: `${host.host}:${host.port}`,
      username: host.username,
      color: host.color,
      status: 'connecting',
      sftpActivated: false,
      sftpPath: '.',
      sftpEntries: [],
      sftpLoading: false,
      metrics: null,
      tunnels: [],
      createdAt: Date.now(),
    };
  }

  async function cleanupSingleSession(sessionId: string): Promise<void> {
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
  }

  /**
   * 基于主机配置新建标签页并建立 SSH 终端会话
   */
  async function openSession(
    host: HostProfile,
    allHosts: HostProfile[],
    cols = 100,
    rows = 30,
  ): Promise<TerminalSession> {
    await initEventListeners();
    const session = createSessionObject(host);
    const leaf = createLeafNode(session.id);
    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      title: session.title,
      layout: leaf,
      focusedPaneId: leaf.paneId,
    };

    sessions.value.push(session);
    tabs.value.push(tab);
    activeTabId.value = tab.id;
    activeSessionId.value = session.id;

    await establishConnection(session, host, allHosts, cols, rows, true);
    return session;
  }

  /**
   * 对指定标签页内的目标终端窗口执行左右或上下分屏（支持无限嵌套分屏）
   */
  async function splitPane(
    tabId: string,
    targetPaneId: string,
    direction: SplitDirection,
    allHosts: HostProfile[],
    cols = 80,
    rows = 24,
  ): Promise<TerminalSession | null> {
    const tab = tabs.value.find((t) => t.id === tabId);
    if (!tab) return null;

    const targetLeaf = findLeafByPaneId(tab.layout, targetPaneId);
    if (!targetLeaf) return null;

    const sourceSession = sessions.value.find((s) => s.id === targetLeaf.sessionId);
    if (!sourceSession) return null;

    const host =
      allHosts.find((h) => h.id === sourceSession.hostId) ?? sourceSession.hostSnapshot;
    if (!host) return null;

    await initEventListeners();
    const newSession = createSessionObject(host);
    const splitResult = splitLeafNode(tab.layout, targetPaneId, direction, newSession.id);
    if (!splitResult.changed) return null;

    sessions.value.push(newSession);
    tab.layout = splitResult.root;
    tab.focusedPaneId = splitResult.newPaneId;
    activeTabId.value = tab.id;
    activeSessionId.value = newSession.id;

    await establishConnection(newSession, host, allHosts, cols, rows, false);
    return newSession;
  }

  /**
   * 切换活动标签页并同步聚焦窗格对应的会话
   */
  function selectTab(tabId: string): void {
    const tab = tabs.value.find((t) => t.id === tabId);
    if (!tab) return;
    activeTabId.value = tab.id;
    const focused =
      findLeafByPaneId(tab.layout, tab.focusedPaneId) ?? collectLeaves(tab.layout)[0];
    if (focused) {
      tab.focusedPaneId = focused.paneId;
      activeSessionId.value = focused.sessionId;
    }
  }

  /**
   * 聚焦标签页中的某个分屏窗格
   */
  function focusPane(tabId: string, paneId: string): void {
    const tab = tabs.value.find((t) => t.id === tabId);
    if (!tab) return;
    const leaf = findLeafByPaneId(tab.layout, paneId);
    if (!leaf) return;
    activeTabId.value = tab.id;
    tab.focusedPaneId = paneId;
    activeSessionId.value = leaf.sessionId;
  }

  /**
   * 更新分屏分割线比例
   */
  function setSplitRatio(tabId: string, splitId: string, ratio: number): void {
    const tab = tabs.value.find((t) => t.id === tabId);
    if (!tab) return;
    tab.layout = updateSplitRatio(tab.layout, splitId, ratio);
  }

  /**
   * 关闭单个分屏窗格；若为标签页内最后一个窗格，则一并关闭该标签页
   */
  async function closePane(tabId: string, paneId: string): Promise<void> {
    const tabIdx = tabs.value.findIndex((t) => t.id === tabId);
    if (tabIdx < 0) return;
    const tab = tabs.value[tabIdx];
    const result = removeLeafNode(tab.layout, paneId);
    if (!result.removedSessionId) return;

    await cleanupSingleSession(result.removedSessionId);

    if (!result.root) {
      tabs.value.splice(tabIdx, 1);
      if (activeTabId.value === tabId) {
        const nextTab = tabs.value[Math.max(0, tabIdx - 1)] ?? null;
        activeTabId.value = nextTab?.id ?? null;
        if (nextTab) {
          const leaf =
            findLeafByPaneId(nextTab.layout, nextTab.focusedPaneId) ??
            collectLeaves(nextTab.layout)[0];
          activeSessionId.value = leaf?.sessionId ?? null;
        } else {
          activeSessionId.value = null;
        }
      }
      return;
    }

    tab.layout = result.root;
    const currentFocusedStillExists = findLeafByPaneId(tab.layout, tab.focusedPaneId);
    const nextLeaf =
      currentFocusedStillExists ??
      (result.nextFocusPaneId ? findLeafByPaneId(tab.layout, result.nextFocusPaneId) : null) ??
      collectLeaves(tab.layout)[0];
    if (nextLeaf) {
      tab.focusedPaneId = nextLeaf.paneId;
      if (activeTabId.value === tabId) {
        activeSessionId.value = nextLeaf.sessionId;
      }
    }
  }

  /**
   * 关闭整个标签页及其下全部分屏会话
   */
  async function closeTab(tabId: string): Promise<void> {
    const tabIdx = tabs.value.findIndex((t) => t.id === tabId);
    if (tabIdx < 0) return;
    const tab = tabs.value[tabIdx];
    const leaves = collectLeaves(tab.layout);
    for (const leaf of leaves) {
      await cleanupSingleSession(leaf.sessionId);
    }
    tabs.value.splice(tabIdx, 1);
    if (activeTabId.value === tabId) {
      const nextTab = tabs.value[Math.max(0, tabIdx - 1)] ?? null;
      activeTabId.value = nextTab?.id ?? null;
      if (nextTab) {
        const leaf =
          findLeafByPaneId(nextTab.layout, nextTab.focusedPaneId) ??
          collectLeaves(nextTab.layout)[0];
        activeSessionId.value = leaf?.sessionId ?? null;
      } else {
        activeSessionId.value = null;
      }
    }
  }

  /**
   * 原地重连指定会话（保留当前分屏窗格与终端缓冲区）
   */
  async function reconnectSession(
    sessionId: string,
    allHosts: HostProfile[],
    cols = 100,
    rows = 30,
  ): Promise<void> {
    const session = sessions.value.find((s) => s.id === sessionId);
    if (!session) return;
    const host = allHosts.find((h) => h.id === session.hostId) ?? session.hostSnapshot;
    if (!host) return;

    if (isTauriRuntime()) {
      try {
        await tauriApi.disconnectSession(sessionId);
      } catch {
        // 忽略已断开会话
      }
    }
    session.status = 'connecting';
    session.errorMessage = undefined;
    session.tunnels = [];
    await establishConnection(session, host, allHosts, cols, rows, false);
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
   * 关闭指定终端会话（若处于分屏中则仅关闭对应分屏窗格）
   */
  async function closeSession(sessionId: string): Promise<void> {
    for (const tab of tabs.value) {
      const leaf = findLeafBySessionId(tab.layout, sessionId);
      if (leaf) {
        await closePane(tab.id, leaf.paneId);
        return;
      }
    }
    await cleanupSingleSession(sessionId);
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[sessions.value.length - 1]?.id ?? null;
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
   * 标记当前会话已启用 SFTP（仅在点击 SFTP 文件按钮后触发）
   */
  function activateSftp(sessionId: string): void {
    const session = sessions.value.find((s) => s.id === sessionId);
    if (session) {
      session.sftpActivated = true;
    }
  }

  /**
   * 刷新当前会话 SFTP 目录列表
   */
  async function refreshSftp(sessionId: string, path?: string): Promise<void> {
    const session = sessions.value.find((s) => s.id === sessionId);
    if (!session || session.status !== 'connected' || !isTauriRuntime()) return;

    session.sftpActivated = true;
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
    tabs,
    activeTabId,
    activeTab,
    activeSessionId,
    activeSession,
    pendingChallenge,
    knownHosts,
    activeTransfer,
    initEventListeners,
    registerOutputSink,
    unregisterOutputSink,
    openSession,
    splitPane,
    selectTab,
    focusPane,
    setSplitRatio,
    closePane,
    closeTab,
    reconnectSession,
    sendInput,
    broadcastCommand,
    resizeSession,
    closeSession,
    resolveHostKeyChallenge,
    activateSftp,
    refreshSftp,
    startForward,
    stopForward,
    refreshMetrics,
    loadKnownHosts,
    removeKnownHost,
  };
});
