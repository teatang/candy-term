import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { isTauriRuntime, tauriApi } from '@/lib/tauri';
import type { CommandSnippet } from '@/types/ssh';

const STORAGE_KEY = 'candy_term_snippets_v1';

/**
 * 内置常用运维快捷命令片段
 */
export const DEFAULT_SNIPPETS: CommandSnippet[] = [
  {
    id: 'sys-overview',
    title: 'System Overview',
    category: 'System',
    command: 'uname -a && uptime && free -h && df -hT',
    description: 'Kernel, uptime, memory and disk overview',
  },
  {
    id: 'docker-ps',
    title: 'Docker Containers',
    category: 'Docker',
    command: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    description: 'List active Docker containers cleanly',
  },
  {
    id: 'listening-ports',
    title: 'Listening Ports',
    category: 'Network',
    command: 'ss -tulnp || netstat -tulnp',
    description: 'Inspect TCP/UDP listening sockets',
  },
  {
    id: 'top-mem',
    title: 'Top Memory Processes',
    category: 'System',
    command: 'ps aux --sort=-%mem | head -n 15',
    description: 'Top 15 processes sorted by memory',
  },
];

/**
 * 快捷命令片段管理 Store
 */
export const useSnippetStore = defineStore('snippets', () => {
  const snippets = ref<CommandSnippet[]>([...DEFAULT_SNIPPETS]);
  const searchQuery = ref('');

  const filteredSnippets = computed<CommandSnippet[]>(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return snippets.value;
    return snippets.value.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q),
    );
  });

  async function loadSnippets(): Promise<void> {
    try {
      if (isTauriRuntime()) {
        const remote = await tauriApi.loadSnippets();
        snippets.value = remote.length > 0 ? remote : [...DEFAULT_SNIPPETS];
      } else {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as CommandSnippet[];
          snippets.value = parsed.length > 0 ? parsed : [...DEFAULT_SNIPPETS];
        }
      }
    } catch {
      snippets.value = [...DEFAULT_SNIPPETS];
    }
  }

  async function persist(): Promise<void> {
    if (isTauriRuntime()) {
      await tauriApi.saveSnippets(snippets.value);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets.value));
    }
  }

  async function addSnippet(input: Omit<CommandSnippet, 'id'>): Promise<CommandSnippet> {
    const item: CommandSnippet = { ...input, id: crypto.randomUUID() };
    snippets.value.unshift(item);
    await persist();
    return item;
  }

  async function removeSnippet(id: string): Promise<void> {
    snippets.value = snippets.value.filter((s) => s.id !== id);
    await persist();
  }

  return {
    snippets,
    searchQuery,
    filteredSnippets,
    loadSnippets,
    addSnippet,
    removeSnippet,
  };
});
