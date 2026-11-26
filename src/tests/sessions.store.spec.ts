import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { i18n } from '@/i18n';
import * as tauriMod from '@/lib/tauri';
import { createEmptyHost } from '@/stores/hosts';
import { useSessionStore } from '@/stores/sessions';
import { useSnippetStore } from '@/stores/snippets';

describe('useSessionStore 与 useSnippetStore 会话及命令管理', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    i18n.global.locale.value = 'zh-CN';
  });

  it('能打开会话、缓冲并回放终端输出、广播指令及关闭标签切换焦点', async () => {
    const sessionStore = useSessionStore();
    const host = createEmptyHost();
    host.name = 'Node Alpha';
    host.host = '192.168.10.2';

    const s1 = await sessionStore.openSession(host, [host]);
    expect(sessionStore.sessions).toHaveLength(1);
    expect(sessionStore.activeSessionId).toBe(s1.id);
    expect(s1.status).toBe('connected');

    const chunks: string[] = [];
    sessionStore.registerOutputSink(s1.id, (data) => chunks.push(data));
    // 早期连接中与欢迎消息应已回放
    const joined = chunks.join('');
    expect(joined).toContain('正在连接到 root@192.168.10.2:22');
    expect(joined).toContain('candy-term preview shell');

    const sentCount = await sessionStore.broadcastCommand('uname -a');
    expect(sentCount).toBe(1);
    expect(chunks.join('')).toContain('uname -a');

    const s2 = await sessionStore.openSession({ ...host, id: 'h2', name: 'Node Beta' }, [host]);
    expect(sessionStore.activeSessionId).toBe(s2.id);

    await sessionStore.closeSession(s2.id);
    expect(sessionStore.sessions).toHaveLength(1);
    expect(sessionStore.activeSessionId).toBe(s1.id);
  });

  it('默认不自动激活 SFTP，仅在显式激活后标记；支持无限分屏、切换焦点与关闭分屏', async () => {
    const sessionStore = useSessionStore();
    const host = createEmptyHost();
    host.name = 'Split Server';
    host.host = '10.0.0.88';

    const s1 = await sessionStore.openSession(host, [host]);
    expect(s1.sftpActivated).toBe(false);
    sessionStore.activateSftp(s1.id);
    expect(s1.sftpActivated).toBe(true);

    const tab = sessionStore.activeTab!;
    const firstPaneId = tab.focusedPaneId;

    const s2 = await sessionStore.splitPane(tab.id, firstPaneId, 'horizontal', [host]);
    expect(s2).not.toBeNull();
    expect(s2!.sftpActivated).toBe(false);
    expect(sessionStore.sessions).toHaveLength(2);
    expect(sessionStore.activeSessionId).toBe(s2!.id);

    const secondPaneId = tab.focusedPaneId;
    const s3 = await sessionStore.splitPane(tab.id, secondPaneId, 'vertical', [host]);
    expect(s3).not.toBeNull();
    expect(sessionStore.sessions).toHaveLength(3);

    sessionStore.focusPane(tab.id, firstPaneId);
    expect(sessionStore.activeSessionId).toBe(s1.id);

    await sessionStore.closePane(tab.id, secondPaneId);
    expect(sessionStore.sessions).toHaveLength(2);
    expect(sessionStore.activeSessionId).toBe(s1.id);

    await sessionStore.closeTab(tab.id);
    expect(sessionStore.sessions).toHaveLength(0);
    expect(sessionStore.tabs).toHaveLength(0);
    expect(sessionStore.activeSessionId).toBeNull();
  });

  it('快捷命令片段支持增删与关键词过滤', async () => {
    const snippetStore = useSnippetStore();
    await snippetStore.loadSnippets();
    const initialLen = snippetStore.snippets.length;
    expect(initialLen).toBeGreaterThan(0);

    const added = await snippetStore.addSnippet({
      title: 'Check Nginx',
      category: 'Web',
      command: 'nginx -t && systemctl reload nginx',
    });
    expect(snippetStore.snippets).toHaveLength(initialLen + 1);

    snippetStore.searchQuery = 'nginx';
    expect(snippetStore.filteredSnippets.some((s) => s.id === added.id)).toBe(true);

    await snippetStore.removeSnippet(added.id);
    expect(snippetStore.snippets).toHaveLength(initialLen);
  });

  it('开始连接与连接失败时均会在终端输出对应提示信息', async () => {
    const runtimeSpy = vi.spyOn(tauriMod, 'isTauriRuntime').mockReturnValue(true);
    const connectSpy = vi
      .spyOn(tauriMod.tauriApi, 'connectSession')
      .mockRejectedValueOnce(new Error('Authentication failed'));
    const listenSpy = vi
      .spyOn(tauriMod.tauriApi, 'onTerminalOutput')
      .mockResolvedValue(() => {});
    const statusSpy = vi
      .spyOn(tauriMod.tauriApi, 'onSessionStatus')
      .mockResolvedValue(() => {});
    const keySpy = vi
      .spyOn(tauriMod.tauriApi, 'onHostKeyChallenge')
      .mockResolvedValue(() => {});
    const sftpSpy = vi
      .spyOn(tauriMod.tauriApi, 'onSftpProgress')
      .mockResolvedValue(() => {});

    try {
      const sessionStore = useSessionStore();
      const host = createEmptyHost();
      host.name = 'Unreachable';
      host.host = '10.99.99.99';
      host.username = 'ops';

      const session = await sessionStore.openSession(host, [host]);
      expect(session.status).toBe('error');

      const chunks: string[] = [];
      sessionStore.registerOutputSink(session.id, (chunk) => chunks.push(chunk));
      const output = chunks.join('');
      expect(output).toContain('正在连接到 ops@10.99.99.99:22');
      expect(output).toContain('连接失败：Error: Authentication failed');
    } finally {
      runtimeSpy.mockRestore();
      connectSpy.mockRestore();
      listenSpy.mockRestore();
      statusSpy.mockRestore();
      keySpy.mockRestore();
      sftpSpy.mockRestore();
    }
  });
});
