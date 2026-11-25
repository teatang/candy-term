import { createI18n } from 'vue-i18n';
import zhCN from './zh-CN';
import enUS from './en-US';
import type { LocaleCode } from '@/types/ssh';

/**
 * 根据浏览器/系统语言自动识别默认语言（中文环境返回 zh-CN，其余返回 en-US）
 */
export function detectSystemLocale(lang?: string): LocaleCode {
  const raw = (lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US')).toLowerCase();
  if (raw.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

/**
 * 创建全局 vue-i18n 实例
 */
export function createAppI18n(initialLocale?: LocaleCode) {
  return createI18n({
    legacy: false,
    locale: initialLocale ?? detectSystemLocale(),
    fallbackLocale: 'en-US',
    messages: {
      'zh-CN': zhCN,
      'en-US': enUS,
    },
  });
}

export const i18n = createAppI18n();
