import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createEmptyHost, useHostsStore } from '@/stores/hosts';

describe('useHostsStore 主机配置管理', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('支持增删改查、收藏、复制及分组搜索过滤', async () => {
    const store = useHostsStore();
    await store.loadHosts();
    expect(store.hosts).toHaveLength(0);

    const h1 = createEmptyHost();
    h1.name = 'Production DB';
    h1.host = '10.1.0.10';
    h1.group = 'Prod';
    h1.tags = ['postgres', 'critical'];
    h1.auth = { type: 'privateKey', privateKeyPath: '~/.ssh/id_ed25519' };

    const h2 = createEmptyHost();
    h2.name = 'Staging App';
    h2.host = '10.2.0.20';
    h2.group = 'Staging';
    h2.proxy = { type: 'socks5', host: '127.0.0.1', port: 1080 };

    await store.upsertHost(h1);
    await store.upsertHost(h2);
    expect(store.hosts).toHaveLength(2);
    expect(store.groups).toEqual(['Prod', 'Staging']);

    await store.toggleFavorite(h2.id);
    store.favoritesOnly = true;
    expect(store.filteredHosts.map((h) => h.id)).toEqual([h2.id]);

    store.favoritesOnly = false;
    store.searchQuery = 'postgres';
    expect(store.filteredHosts.map((h) => h.id)).toEqual([h1.id]);

    const copied = await store.duplicateHost(h1.id);
    expect(copied).not.toBeNull();
    expect(store.hosts).toHaveLength(3);

    await store.deleteHost(h2.id);
    expect(store.hosts).toHaveLength(2);
  });

  it('支持完整 JSON 导出与导入（含代理和端口转发规则）', async () => {
    const store = useHostsStore();
    const h = createEmptyHost();
    h.name = 'Jump Target';
    h.host = '172.16.8.9';
    h.forwards = [
      {
        id: 'rule-1',
        name: 'MySQL',
        forwardType: 'local',
        localHost: '127.0.0.1',
        localPort: 13306,
        remoteHost: '127.0.0.1',
        remotePort: 3306,
        autoStart: true,
      },
    ];
    await store.upsertHost(h);

    const exported = store.exportHostsJson();
    localStorage.clear();
    setActivePinia(createPinia());
    const freshStore = useHostsStore();
    const importedCount = await freshStore.importHostsJson(exported);
    expect(importedCount).toBe(1);
    expect(freshStore.hosts[0].forwards[0].remotePort).toBe(3306);
  });
});
