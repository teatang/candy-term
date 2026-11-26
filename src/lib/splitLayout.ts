/**
 * 终端无限分屏二叉树布局模型与几何计算工具
 */
export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitLeafNode {
  type: 'leaf';
  paneId: string;
  sessionId: string;
}

export interface SplitBranchNode {
  type: 'split';
  splitId: string;
  direction: SplitDirection;
  ratio: number;
  first: SplitNode;
  second: SplitNode;
}

export type SplitNode = SplitLeafNode | SplitBranchNode;

export interface SplitRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PositionedLeaf {
  paneId: string;
  sessionId: string;
  rect: SplitRect;
}

export interface PositionedDivider {
  splitId: string;
  direction: SplitDirection;
  ratio: number;
  parentRect: SplitRect;
  linePercent: number;
}

const MIN_SPLIT_RATIO = 0.15;
const MAX_SPLIT_RATIO = 0.85;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function createLeafNode(
  sessionId: string,
  paneId: string = crypto.randomUUID(),
): SplitLeafNode {
  return {
    type: 'leaf',
    paneId,
    sessionId,
  };
}

/**
 * 收集分屏树中全部叶子节点（按先序遍历）
 */
export function collectLeaves(node: SplitNode): SplitLeafNode[] {
  if (node.type === 'leaf') {
    return [node];
  }
  return [...collectLeaves(node.first), ...collectLeaves(node.second)];
}

/**
 * 根据 paneId 查找叶子节点
 */
export function findLeafByPaneId(node: SplitNode, paneId: string): SplitLeafNode | null {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? node : null;
  }
  return findLeafByPaneId(node.first, paneId) ?? findLeafByPaneId(node.second, paneId);
}

/**
 * 根据 sessionId 查找叶子节点
 */
export function findLeafBySessionId(node: SplitNode, sessionId: string): SplitLeafNode | null {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? node : null;
  }
  return findLeafBySessionId(node.first, sessionId) ?? findLeafBySessionId(node.second, sessionId);
}

/**
 * 将指定叶子节点按方向拆分为左右或上下两个分屏
 */
export function splitLeafNode(
  root: SplitNode,
  targetPaneId: string,
  direction: SplitDirection,
  newSessionId: string,
  newPaneId: string = crypto.randomUUID(),
): { root: SplitNode; newPaneId: string; changed: boolean } {
  if (root.type === 'leaf') {
    if (root.paneId !== targetPaneId) {
      return { root, newPaneId, changed: false };
    }
    return {
      root: {
        type: 'split',
        splitId: crypto.randomUUID(),
        direction,
        ratio: 0.5,
        first: root,
        second: createLeafNode(newSessionId, newPaneId),
      },
      newPaneId,
      changed: true,
    };
  }

  const leftResult = splitLeafNode(root.first, targetPaneId, direction, newSessionId, newPaneId);
  if (leftResult.changed) {
    return {
      root: { ...root, first: leftResult.root },
      newPaneId: leftResult.newPaneId,
      changed: true,
    };
  }

  const rightResult = splitLeafNode(root.second, targetPaneId, direction, newSessionId, newPaneId);
  if (rightResult.changed) {
    return {
      root: { ...root, second: rightResult.root },
      newPaneId: rightResult.newPaneId,
      changed: true,
    };
  }

  return { root, newPaneId, changed: false };
}

/**
 * 关闭指定分屏叶子节点，并将剩余兄弟节点提升回父级位置
 */
export function removeLeafNode(
  root: SplitNode,
  targetPaneId: string,
): { root: SplitNode | null; removedSessionId: string | null; nextFocusPaneId: string | null } {
  if (root.type === 'leaf') {
    if (root.paneId === targetPaneId) {
      return { root: null, removedSessionId: root.sessionId, nextFocusPaneId: null };
    }
    return { root, removedSessionId: null, nextFocusPaneId: null };
  }

  if (root.first.type === 'leaf' && root.first.paneId === targetPaneId) {
    const remainingLeaves = collectLeaves(root.second);
    return {
      root: root.second,
      removedSessionId: root.first.sessionId,
      nextFocusPaneId: remainingLeaves[0]?.paneId ?? null,
    };
  }

  if (root.second.type === 'leaf' && root.second.paneId === targetPaneId) {
    const remainingLeaves = collectLeaves(root.first);
    return {
      root: root.first,
      removedSessionId: root.second.sessionId,
      nextFocusPaneId: remainingLeaves[remainingLeaves.length - 1]?.paneId ?? null,
    };
  }

  const leftRes = removeLeafNode(root.first, targetPaneId);
  if (leftRes.removedSessionId && leftRes.root) {
    return {
      root: { ...root, first: leftRes.root },
      removedSessionId: leftRes.removedSessionId,
      nextFocusPaneId: leftRes.nextFocusPaneId,
    };
  }

  const rightRes = removeLeafNode(root.second, targetPaneId);
  if (rightRes.removedSessionId && rightRes.root) {
    return {
      root: { ...root, second: rightRes.root },
      removedSessionId: rightRes.removedSessionId,
      nextFocusPaneId: rightRes.nextFocusPaneId,
    };
  }

  return { root, removedSessionId: null, nextFocusPaneId: null };
}

/**
 * 更新指定分割线的比例
 */
export function updateSplitRatio(root: SplitNode, splitId: string, ratio: number): SplitNode {
  if (root.type === 'leaf') return root;
  if (root.splitId === splitId) {
    return { ...root, ratio: clampSplitRatio(ratio) };
  }
  return {
    ...root,
    first: updateSplitRatio(root.first, splitId, ratio),
    second: updateSplitRatio(root.second, splitId, ratio),
  };
}

/**
 * 将分屏二叉树扁平化为绝对定位百分比矩形列表与拖拽分割线列表，
 * 使同一 paneId 在分屏/关闭分屏过程中保持稳定挂载不丢失终端缓冲区。
 */
export function computeSplitLayout(root: SplitNode): {
  leaves: PositionedLeaf[];
  dividers: PositionedDivider[];
} {
  const leaves: PositionedLeaf[] = [];
  const dividers: PositionedDivider[] = [];

  function walk(node: SplitNode, rect: SplitRect): void {
    if (node.type === 'leaf') {
      leaves.push({
        paneId: node.paneId,
        sessionId: node.sessionId,
        rect,
      });
      return;
    }

    const ratio = clampSplitRatio(node.ratio);
    if (node.direction === 'horizontal') {
      const firstWidth = rect.width * ratio;
      const splitX = rect.left + firstWidth;
      dividers.push({
        splitId: node.splitId,
        direction: 'horizontal',
        ratio,
        parentRect: rect,
        linePercent: splitX,
      });
      walk(node.first, {
        left: rect.left,
        top: rect.top,
        width: firstWidth,
        height: rect.height,
      });
      walk(node.second, {
        left: splitX,
        top: rect.top,
        width: rect.width - firstWidth,
        height: rect.height,
      });
    } else {
      const firstHeight = rect.height * ratio;
      const splitY = rect.top + firstHeight;
      dividers.push({
        splitId: node.splitId,
        direction: 'vertical',
        ratio,
        parentRect: rect,
        linePercent: splitY,
      });
      walk(node.first, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: firstHeight,
      });
      walk(node.second, {
        left: rect.left,
        top: splitY,
        width: rect.width,
        height: rect.height - firstHeight,
      });
    }
  }

  walk(root, { left: 0, top: 0, width: 100, height: 100 });
  return { leaves, dividers };
}
