import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { i18n } from '@/i18n';
import { createEmptyHost, useHostsStore } from '@/stores/hosts';
import { useSettingsStore } from '@/stores/settings';
import HostSidebar from '@/components/hosts/HostSidebar.vue';
import HostDialog from '@/components/hosts/HostDialog.vue';
import SettingsDialog from '@/components/tools/SettingsDialog.vue';

describe('Vue 核心 UI 组件集成测试', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
    i18n.global.locale.value = 'zh-CN';
  });

  it('HostSidebar 能渲染主机卡片、响应搜索并触发连接与编辑事件', async () => {
    const store = useHostsStore();
    const host = createEmptyHost();
    host.name = 'Tokyo Gateway';
    host.host = '103.1.2.3';
    host.username = 'ops';
    await store.upsertHost(host);

    const wrapper = mount(HostSidebar, {
      global: { plugins: [pinia, i18n] },
    });

    expect(wrapper.text()).toContain('Tokyo Gateway');
    expect(wrapper.text()).toContain('ops@103.1.2.3:22');

    await wrapper.find('input[type="text"]').setValue('not-exist');
    expect(wrapper.text()).not.toContain('Tokyo Gateway');

    await wrapper.find('input[type="text"]').setValue('Tokyo');
    expect(wrapper.text()).toContain('Tokyo Gateway');

    await wrapper.find('button[title="连接"]').trigger('click');
    expect(wrapper.emitted('connectHost')?.[0]?.[0]).toMatchObject({ id: host.id });
  });

  it('HostDialog 支持多认证方式与端口转发配置并保存', async () => {
    const wrapper = mount(HostDialog, {
      props: { open: true, editingHost: null },
      global: {
        plugins: [pinia, i18n],
        stubs: {
          DialogPortal: { template: '<div><slot /></div>' },
          Teleport: true,
        },
      },
    });

    const inputs = wrapper.findAll('input');
    await inputs[0].setValue('Bastion Node');
    await inputs[2].setValue('10.20.30.40');

    // 切换到认证方式页签并选择 SSH Agent
    const tabButtons = wrapper.findAll('button');
    const authTab = tabButtons.find((b) => b.text().includes('认证方式'));
    await authTab?.trigger('click');
    await wrapper.find('select').setValue('agent');

    // 点击「保存配置」
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存配置');
    await saveBtn?.trigger('click');

    const store = useHostsStore();
    expect(store.hosts).toHaveLength(1);
    expect(store.hosts[0].name).toBe('Bastion Node');
    expect(store.hosts[0].host).toBe('10.20.30.40');
    expect(store.hosts[0].auth.type).toBe('agent');
  });

  it('SettingsDialog 支持切换日夜主题与界面语言', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.setLocale('zh-CN');

    const wrapper = mount(SettingsDialog, {
      props: { open: true },
      global: {
        plugins: [pinia, i18n],
        stubs: {
          DialogPortal: { template: '<div><slot /></div>' },
          Teleport: true,
        },
      },
    });

    const darkBtn = wrapper.findAll('button').find((b) => b.text().includes('夜间模式'));
    await darkBtn?.trigger('click');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    const select = wrapper.findAll('select')[0];
    await select.setValue('en-US');
    expect(i18n.global.locale.value).toBe('en-US');
  });
});
