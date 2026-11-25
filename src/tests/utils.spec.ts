import { describe, expect, it } from 'vitest';
import { cn, formatBytes, formatTimestamp, formatUptime } from '@/lib/utils';

describe('utils 工具函数单元测试', () => {
  it('formatBytes 正确格式化各量级字节数', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('formatUptime 正确计算天/小时/分钟', () => {
    expect(formatUptime(0)).toBe('0m');
    expect(formatUptime(3660)).toBe('1h 1m');
    expect(formatUptime(90060)).toBe('1d 1h 1m');
  });

  it('formatTimestamp 正确处理空值与有效时间戳', () => {
    expect(formatTimestamp(null)).toBe('-');
    expect(formatTimestamp(1_700_000_000)).not.toBe('-');
  });

  it('cn 正确合并并去重 Tailwind 类名', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});
