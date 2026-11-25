import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSettingsStore } from '@/stores/settings';
import { i18n } from '@/i18n';

describe('useSettingsStore 全局设置与日夜模式', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    setActivePinia(createPinia());
  });

  it('支持日间、夜间与跟随系统模式切换并自动同步 DOM dark 类', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    const store = useSettingsStore();
    expect(store.theme).toBe('system');
    expect(store.isDark).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    store.setTheme('light');
    expect(store.isDark).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    store.setTheme('dark');
    expect(store.isDark).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    store.cycleTheme(); // dark -> system
    expect(store.theme).toBe('system');
  });

  it('支持切换中英文并持久化到本地存储', () => {
    const store = useSettingsStore();
    store.setLocale('en-US');
    expect(i18n.global.locale.value).toBe('en-US');

    store.toggleLocale();
    expect(store.locale).toBe('zh-CN');
    expect(i18n.global.locale.value).toBe('zh-CN');

    store.fontSize = 16;
    store.resetDefaults();
    expect(store.fontSize).toBe(13.5);
  });
});
