import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { isTauriRuntime, tauriApi } from '@/lib/tauri';
import type { HostProfile } from '@/types/ssh';

const STORAGE_KEY = 'candy_term_hosts_v1';

/**
 * 糖果色预设调色板（用于区分环境/分组）
 */
export const CANDY_COLORS = [
  '#ec4899', // 草莓粉
  '#8b5cf6', // 葡萄紫
  '#06b6d4', // 薄荷青
  '#10b981', // 青柠绿
  '#f59e0b', // 芒果橙
  '#3b82f6', // 蓝莓蓝
] as const;

/**
 * 深拷贝主机配置（兼容 Vue 响应式 Proxy 对象）
 */
export function cloneHostProfile(host: HostProfile): HostProfile {
  return JSON.parse(JSON.stringify(host)) as HostProfile;
}

/**
 * 创建空白主机表单默认值
 */
export function createEmptyHost(): HostProfile {
  return {
    id: crypto.randomUUID(),
    name: '',
    host: '',
    port: 22,
    username: 'root',
    group: 'Default',
    color: CANDY_COLORS[0],
    favorite: false,
    tags: [],
    notes: '',
    auth: { type: 'password', password: '' },
    proxy: { type: 'none' },
    forwards: [],
    keepaliveIntervalSecs: 30,
    lastConnectedAt: null,
  };
}

/**
 * SSH 主机配置管理 Store
 */
export const useHostsStore = defineStore('hosts', () => {
  const hosts = ref<HostProfile[]>([]);
  const searchQuery = ref('');
  const selectedGroup = ref<string>('__ALL__');
  const favoritesOnly = ref(false);
  const loaded = ref(false);

  /**
   * 全部去重后的分组列表
   */
  const groups = computed<string[]>(() => {
    const set = new Set<string>();
    for (const h of hosts.value) {
      set.add(h.group?.trim() || 'Default');
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  });

  /**
   * 根据搜索关键词、分组与收藏筛选后的主机列表
   */
  const filteredHosts = computed<HostProfile[]>(() => {
    const q = searchQuery.value.trim().toLowerCase();
    return hosts.value
      .filter((h) => {
        if (favoritesOnly.value && !h.favorite) return false;
        if (selectedGroup.value !== '__ALL__' && (h.group || 'Default') !== selectedGroup.value) {
          return false;
        }
        if (!q) return true;
        const haystack = [h.name, h.host, h.username, h.group, ...h.tags, h.notes]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  });

  /**
   * 从 Tauri 后端或本地缓存加载主机列表
   */
  async function loadHosts(): Promise<void> {
    try {
      if (isTauriRuntime()) {
        hosts.value = await tauriApi.loadHosts();
      } else {
        const raw = localStorage.getItem(STORAGE_KEY);
        hosts.value = raw ? (JSON.parse(raw) as HostProfile[]) : [];
      }
    } catch {
      hosts.value = [];
    } finally {
      loaded.value = true;
    }
  }

  /**
   * 持久化保存主机列表
   */
  async function persistHosts(): Promise<void> {
    if (isTauriRuntime()) {
      await tauriApi.saveHosts(hosts.value);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts.value));
    }
  }

  /**
   * 新增或更新主机配置
   */
  async function upsertHost(profile: HostProfile): Promise<HostProfile> {
    const cloned = cloneHostProfile(profile);
    const idx = hosts.value.findIndex((h) => h.id === cloned.id);
    if (idx >= 0) {
      hosts.value[idx] = cloned;
    } else {
      hosts.value.push(cloned);
    }
    await persistHosts();
    return cloned;
  }

  /**
   * 复制现有主机配置为新主机
   */
  async function duplicateHost(id: string): Promise<HostProfile | null> {
    const target = hosts.value.find((h) => h.id === id);
    if (!target) return null;
    const copy: HostProfile = {
      ...cloneHostProfile(target),
      id: crypto.randomUUID(),
      name: `${target.name} (Copy)`,
      lastConnectedAt: null,
    };
    hosts.value.push(copy);
    await persistHosts();
    return copy;
  }

  /**
   * 删除指定主机配置
   */
  async function deleteHost(id: string): Promise<void> {
    hosts.value = hosts.value.filter((h) => h.id !== id);
    await persistHosts();
  }

  /**
   * 切换收藏标记
   */
  async function toggleFavorite(id: string): Promise<void> {
    const target = hosts.value.find((h) => h.id === id);
    if (!target) return;
    target.favorite = !target.favorite;
    await persistHosts();
  }

  /**
   * 记录最近连接时间戳
   */
  async function markConnected(id: string): Promise<void> {
    const target = hosts.value.find((h) => h.id === id);
    if (!target) return;
    target.lastConnectedAt = Math.floor(Date.now() / 1000);
    await persistHosts();
  }

  /**
   * 导出主机配置 JSON 字符串
   */
  function exportHostsJson(): string {
    return JSON.stringify(hosts.value, null, 2);
  }

  /**
   * 从 JSON 字符串导入并合并主机配置
   */
  async function importHostsJson(rawJson: string): Promise<number> {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid hosts JSON format');
    }
    let count = 0;
    for (const item of parsed) {
      if (item && typeof item === 'object' && 'host' in item && 'username' in item) {
        const candidate = item as HostProfile;
        const normalized: HostProfile = {
          ...createEmptyHost(),
          ...candidate,
          id: candidate.id || crypto.randomUUID(),
        };
        await upsertHost(normalized);
        count += 1;
      }
    }
    return count;
  }

  return {
    hosts,
    searchQuery,
    selectedGroup,
    favoritesOnly,
    loaded,
    groups,
    filteredHosts,
    loadHosts,
    upsertHost,
    duplicateHost,
    deleteHost,
    toggleFavorite,
    markConnected,
    exportHostsJson,
    importHostsJson,
  };
});
