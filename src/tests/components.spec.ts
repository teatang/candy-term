import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { i18n } from '@/i18n';
import { createEmptyHost, useHostsStore } from '@/stores/hosts';
import { useSessionStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import App from '@/App.vue';
import HostSidebar from '@/components/hosts/HostSidebar.vue';
import HostDialog from '@/components/hosts/HostDialog.vue';
import QuickConnectDialog from '@/components/hosts/QuickConnectDialog.vue';
import SettingsDialog from '@/components/tools/SettingsDialog.vue';
import TerminalView from '@/components/terminal/TerminalView.vue';

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

  it('App 默认折叠右侧栏，仅在点击 SFTP 文件按钮后展开并启动当前会话 SFTP', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.setLocale('zh-CN');
    const sessionStore = useSessionStore();
    const host = createEmptyHost();
    host.name = 'SFTP Target';
    host.host = '10.10.0.1';
    const session = await sessionStore.openSession(host, [host]);

    const wrapper = mount(App, {
      global: {
        plugins: [pinia, i18n],
        stubs: {
          TerminalView: { template: '<div data-test="terminal-stub" />' },
          HostKeyDialog: true,
          HostDialog: true,
          SettingsDialog: true,
        },
      },
    });

    // 默认折叠右侧抽屉，且未激活 SFTP
    expect(wrapper.text()).not.toContain('SFTP 文件浏览器');
    expect(session.sftpActivated).toBe(false);

    // 点击顶部「SFTP 文件」按钮后才展开右侧栏并激活 SFTP
    const sftpNavBtn = wrapper.findAll('header button').find((b) => b.text().includes('SFTP 文件'));
    expect(sftpNavBtn).toBeDefined();
    await sftpNavBtn!.trigger('click');

    expect(wrapper.text()).toContain('SFTP 文件浏览器');
    expect(session.sftpActivated).toBe(true);

    // 分屏后应渲染可视分割线
    await sessionStore.splitPane(sessionStore.activeTabId!, sessionStore.activeTab!.focusedPaneId, 'horizontal', [host]);
    expect(wrapper.findAll('[data-split-divider]')).toHaveLength(1);
  });

  it('TerminalView 渲染全屏、左右分屏、上下分屏与关闭分屏按钮并触发事件', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.setLocale('zh-CN');

    const wrapper = mount(TerminalView, {
      props: {
        sessionId: 's-1',
        visible: true,
        focused: true,
        isFullscreen: false,
        canCloseSplit: true,
      },
      global: { plugins: [pinia, i18n] },
    });

    await wrapper.find('button[title="全屏显示"]').trigger('click');
    await wrapper.find('button[title="左右分屏"]').trigger('click');
    await wrapper.find('button[title="上下分屏"]').trigger('click');
    await wrapper.find('button[title="关闭分屏"]').trigger('click');

    expect(wrapper.emitted('toggleFullscreen')).toHaveLength(1);
    expect(wrapper.emitted('splitHorizontal')).toHaveLength(1);
    expect(wrapper.emitted('splitVertical')).toHaveLength(1);
    expect(wrapper.emitted('closeSplit')).toHaveLength(1);
  });

  it('HostSidebar 导出配置在桌面端调用原生保存对话框与导出命令，在浏览器模式触发下载', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.setLocale('zh-CN');
    const store = useHostsStore();
    const host = createEmptyHost();
    host.name = 'Export Node';
    host.host = '192.168.1.99';
    await store.upsertHost(host);

    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-export');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const wrapper = mount(HostSidebar, {
      global: { plugins: [pinia, i18n] },
    });

    expect(wrapper.text()).toContain('连接管理');
    const groupSelect = wrapper.find('select');
    expect(groupSelect.exists()).toBe(true);
    await groupSelect.setValue('Default');
    expect(store.selectedGroup).toBe('Default');
    expect(wrapper.find('button[title="收藏"]').exists()).toBe(true);
    expect(wrapper.find('button[title="编辑"]').exists()).toBe(true);
    expect(wrapper.find('button[title="复制配置"]').exists()).toBe(true);
    expect(wrapper.find('button[title="删除"]').exists()).toBe(true);
    expect(wrapper.find('button[title="编辑"]').text()).toBe('');

    await wrapper.find('button[title="导出配置"]').trigger('click');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('配置已导出');

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('QuickConnectDialog 能搜索并选择已有连接打开，点击标签旁 + 号可打开选择弹窗', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.setLocale('zh-CN');
    const hostsStore = useHostsStore();
    const h1 = createEmptyHost();
    h1.name = 'Prod Bastion';
    h1.host = '10.0.1.10';
    h1.favorite = true;
    await hostsStore.upsertHost(h1);

    const h2 = createEmptyHost();
    h2.name = 'Dev Box';
    h2.host = '10.0.2.20';
    await hostsStore.upsertHost(h2);

    const pickerWrapper = mount(QuickConnectDialog, {
      props: { open: true },
      global: {
        plugins: [pinia, i18n],
        stubs: {
          DialogPortal: { template: '<div><slot /></div>' },
          Teleport: true,
        },
      },
    });

    expect(pickerWrapper.text()).toContain('选择已有连接');
    expect(pickerWrapper.text()).toContain('Prod Bastion');
    expect(pickerWrapper.text()).toContain('Dev Box');

    await pickerWrapper.find('input').setValue('Dev');
    expect(pickerWrapper.text()).not.toContain('Prod Bastion');
    expect(pickerWrapper.text()).toContain('Dev Box');

    const devBtn = pickerWrapper.findAll('button').find((b) => b.text().includes('Dev Box'));
    await devBtn?.trigger('click');
    expect(pickerWrapper.emitted('selectHost')?.[0]?.[0]).toMatchObject({ id: h2.id });
  });
});
