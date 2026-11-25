import { describe, expect, it } from 'vitest';
import { createAppI18n, detectSystemLocale } from '@/i18n';
import zhCN from '@/i18n/zh-CN';
import enUS from '@/i18n/en-US';

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v as Record<string, unknown>, next));
    } else {
      keys.push(next);
    }
  }
  return keys.sort();
}

describe('i18n 国际化与系统语言探测', () => {
  it('能根据系统语言准确识别中文与英文默认文案', () => {
    expect(detectSystemLocale('zh-CN')).toBe('zh-CN');
    expect(detectSystemLocale('zh-TW')).toBe('zh-CN');
    expect(detectSystemLocale('zh')).toBe('zh-CN');
    expect(detectSystemLocale('en-US')).toBe('en-US');
    expect(detectSystemLocale('en-GB')).toBe('en-US');
    expect(detectSystemLocale('ja-JP')).toBe('en-US');
  });

  it('中英文语言包键名完全对称一致', () => {
    const zhKeys = collectKeys(zhCN as unknown as Record<string, unknown>);
    const enKeys = collectKeys(enUS as unknown as Record<string, unknown>);
    expect(zhKeys).toEqual(enKeys);
  });

  it('支持动态切换中英文翻译输出', () => {
    const i18n = createAppI18n('zh-CN');
    expect(i18n.global.t('app.name')).toBe('糖果终端');
    i18n.global.locale.value = 'en-US';
    expect(i18n.global.t('app.name')).toBe('candy-term');
  });
});
