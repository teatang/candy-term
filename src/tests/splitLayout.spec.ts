import { describe, expect, it } from 'vitest';
import {
  collectLeaves,
  computeSplitLayout,
  createLeafNode,
  removeLeafNode,
  splitLeafNode,
  updateSplitRatio,
} from '@/lib/splitLayout';

describe('splitLayout 无限分屏树形布局算法', () => {
  it('支持无限嵌套的左右与上下分屏，并精确计算百分比矩形', () => {
    const root0 = createLeafNode('s1', 'p1');
    const r1 = splitLeafNode(root0, 'p1', 'horizontal', 's2', 'p2');
    expect(r1.changed).toBe(true);

    const r2 = splitLeafNode(r1.root, 'p2', 'vertical', 's3', 'p3');
    expect(r2.changed).toBe(true);

    const r3 = splitLeafNode(r2.root, 'p3', 'horizontal', 's4', 'p4');
    expect(r3.changed).toBe(true);

    const leaves = collectLeaves(r3.root);
    expect(leaves.map((l) => l.paneId)).toEqual(['p1', 'p2', 'p3', 'p4']);

    const { leaves: positioned, dividers } = computeSplitLayout(r3.root);
    expect(dividers).toHaveLength(3);
    expect(positioned).toEqual([
      { paneId: 'p1', sessionId: 's1', rect: { left: 0, top: 0, width: 50, height: 100 } },
      { paneId: 'p2', sessionId: 's2', rect: { left: 50, top: 0, width: 50, height: 50 } },
      { paneId: 'p3', sessionId: 's3', rect: { left: 50, top: 50, width: 25, height: 50 } },
      { paneId: 'p4', sessionId: 's4', rect: { left: 75, top: 50, width: 25, height: 50 } },
    ]);
  });

  it('支持调整分割比例并限制在安全范围内，同时支持逐个关闭分屏', () => {
    const root0 = createLeafNode('s1', 'p1');
    const r1 = splitLeafNode(root0, 'p1', 'horizontal', 's2', 'p2');
    if (r1.root.type !== 'split') throw new Error('Expected split node');

    const resized = updateSplitRatio(r1.root, r1.root.splitId, 0.99);
    const { leaves: clampedLeaves } = computeSplitLayout(resized);
    expect(clampedLeaves[0].rect.width).toBe(85);
    expect(clampedLeaves[1].rect.width).toBe(15);

    const removed = removeLeafNode(resized, 'p1');
    expect(removed.removedSessionId).toBe('s1');
    expect(removed.nextFocusPaneId).toBe('p2');
    expect(removed.root).toEqual({ type: 'leaf', paneId: 'p2', sessionId: 's2' });

    const removedLast = removeLeafNode(removed.root!, 'p2');
    expect(removedLast.root).toBeNull();
    expect(removedLast.removedSessionId).toBe('s2');
  });
});
