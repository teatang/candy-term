import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createEmptyHost } from '@/stores/hosts';
import { useSessionStore } from '@/stores/sessions';
import { useSnippetStore } from '@/stores/snippets';

describe('useSessionStore 与 useSnippetStore 会话及命令管理', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
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
    // 早期欢迎消息应已回放
    expect(chunks.join('')).toContain('candy-term preview shell');

    const sentCount = await sessionStore.broadcastCommand('uname -a');
    expect(sentCount).toBe(1);
    expect(chunks.join('')).toContain('uname -a');

    const s2 = await sessionStore.openSession({ ...host, id: 'h2', name: 'Node Beta' }, [host]);
    expect(sessionStore.activeSessionId).toBe(s2.id);

    await sessionStore.closeSession(s2.id);
    expect(sessionStore.sessions).toHaveLength(1);
    expect(sessionStore.activeSessionId).toBe(s1.id);
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
});
