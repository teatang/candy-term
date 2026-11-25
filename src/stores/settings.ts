import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { detectSystemLocale, i18n } from '@/i18n';
import type { LocaleCode, ThemeMode } from '@/types/ssh';

const STORAGE_KEY = 'candy_term_settings_v1';

/**
 * 持久化设置结构
 */
export interface PersistedSettings {
  theme: ThemeMode;
  locale: LocaleCode;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  cursorStyle: 'block' | 'underline' | 'bar';
  showHiddenSftp: boolean;
  sidebarCollapsed: boolean;
}

/**
 * 生成默认应用设置（默认语言遵循系统语言）
 */
export function getDefaultSettings(): PersistedSettings {
  return {
    theme: 'system',
    locale: detectSystemLocale(),
    fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, Consolas, monospace',
    fontSize: 13.5,
    lineHeight: 1.35,
    scrollback: 5000,
    cursorStyle: 'bar',
    showHiddenSftp: false,
    sidebarCollapsed: false,
  };
}

/**
 * 全局应用偏好设置 Store（主题、i18n、终端排版参数）
 */
export const useSettingsStore = defineStore('settings', () => {
  const defaults = getDefaultSettings();

  const loadInitial = (): PersistedSettings => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  };

  const initial = loadInitial();

  const theme = ref<ThemeMode>(initial.theme);
  const locale = ref<LocaleCode>(initial.locale);
  const fontFamily = ref<string>(initial.fontFamily);
  const fontSize = ref<number>(initial.fontSize);
  const lineHeight = ref<number>(initial.lineHeight);
  const scrollback = ref<number>(initial.scrollback);
  const cursorStyle = ref<'block' | 'underline' | 'bar'>(initial.cursorStyle);
  const showHiddenSftp = ref<boolean>(initial.showHiddenSftp);
  const sidebarCollapsed = ref<boolean>(initial.sidebarCollapsed);

  // 追踪系统暗色模式实时偏好
  const systemPrefersDark = ref<boolean>(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  /**
   * 解析最终生效的暗色状态（日间 / 夜间 / 跟随系统）
   */
  const isDark = computed<boolean>(() => {
    if (theme.value === 'dark') return true;
    if (theme.value === 'light') return false;
    return systemPrefersDark.value;
  });

  /**
   * 将当前主题与语言同步应用到 DOM 与 vue-i18n
   */
  function applyThemeAndLocale(): void {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', isDark.value);
      document.documentElement.lang = locale.value;
    }
    i18n.global.locale.value = locale.value;
  }

  /**
   * 持久化当前全部配置到 localStorage
   */
  function persist(): void {
    try {
      const payload: PersistedSettings = {
        theme: theme.value,
        locale: locale.value,
        fontFamily: fontFamily.value,
        fontSize: fontSize.value,
        lineHeight: lineHeight.value,
        scrollback: scrollback.value,
        cursorStyle: cursorStyle.value,
        showHiddenSftp: showHiddenSftp.value,
        sidebarCollapsed: sidebarCollapsed.value,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 忽略存储配额等环境异常
    }
  }

  function setTheme(mode: ThemeMode): void {
    theme.value = mode;
  }

  function cycleTheme(): void {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const idx = order.indexOf(theme.value);
    theme.value = order[(idx + 1) % order.length];
  }

  function setLocale(next: LocaleCode): void {
    locale.value = next;
  }

  function toggleLocale(): void {
    locale.value = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
  }

  function resetDefaults(): void {
    const next = getDefaultSettings();
    theme.value = next.theme;
    locale.value = next.locale;
    fontFamily.value = next.fontFamily;
    fontSize.value = next.fontSize;
    lineHeight.value = next.lineHeight;
    scrollback.value = next.scrollback;
    cursorStyle.value = next.cursorStyle;
    showHiddenSftp.value = next.showHiddenSftp;
    sidebarCollapsed.value = next.sidebarCollapsed;
  }

  // 初始化系统颜色方案监听器
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      systemPrefersDark.value = event.matches;
    };
    media.addEventListener?.('change', onChange);
  }

  watch(
    [
      theme,
      locale,
      fontFamily,
      fontSize,
      lineHeight,
      scrollback,
      cursorStyle,
      showHiddenSftp,
      sidebarCollapsed,
      isDark,
    ],
    () => {
      applyThemeAndLocale();
      persist();
    },
    { immediate: true, flush: 'sync' },
  );

  return {
    theme,
    locale,
    fontFamily,
    fontSize,
    lineHeight,
    scrollback,
    cursorStyle,
    showHiddenSftp,
    sidebarCollapsed,
    systemPrefersDark,
    isDark,
    setTheme,
    cycleTheme,
    setLocale,
    toggleLocale,
    resetDefaults,
    applyThemeAndLocale,
  };
});
