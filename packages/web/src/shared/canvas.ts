import { z } from 'zod';

export const canvasLimits = {
  nodes: 24,
  assets: 24,
  assetBytes: 2_000_000,
  projectBytes: 8_000_000,
  selectedImages: 4,
};
const id = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,100}$/)
  .refine(
    (value) => !['__proto__', 'constructor', 'prototype'].includes(value),
  );
const common = {
  id,
  title: z.string().trim().min(1).max(80),
  references: z.array(id).max(8),
};
export const canvasNodeSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...common,
      type: z.literal('document'),
      text: z.string().max(8000),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('image'),
      assetId: z.string().uuid(),
      description: z.string().max(1000),
    })
    .strict(),
]);
const position = z
  .object({ x: z.number().min(0).max(3600), y: z.number().min(0).max(2400) })
  .strict();
export const canvasDocumentSchema = z
  .object({
    version: z.literal(1),
    nodes: z.array(canvasNodeSchema).max(canvasLimits.nodes),
    layout: z.record(id, position),
  })
  .strict()
  .superRefine((board, ctx) => {
    const ids = new Set(board.nodes.map((n) => n.id));
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    if (ids.size !== board.nodes.length) issue('画布中存在重复节点。');
    if (
      Object.keys(board.layout).some((key) => !ids.has(key)) ||
      board.nodes.some((n) => !Object.hasOwn(board.layout, n.id))
    )
      issue('节点位置与画布内容不一致。');
    if (JSON.stringify(board).length > 24000)
      issue('画布内容过长，请精简设计说明。');
    for (const node of board.nodes) {
      if (
        node.references.some((ref) => ref === node.id || !ids.has(ref)) ||
        new Set(node.references).size !== node.references.length
      )
        issue('引用必须指向画布中其他节点，且不能重复。');
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return false;
      if (visited.has(nodeId)) return true;
      visiting.add(nodeId);
      for (const ref of board.nodes.find((n) => n.id === nodeId)?.references ||
        [])
        if (!visit(ref)) return false;
      visiting.delete(nodeId);
      visited.add(nodeId);
      return true;
    };
    if (board.nodes.some((n) => !visit(n.id)))
      issue('引用不能形成循环，请移除其中一条连线。');
  });
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;
export interface CanvasAsset {
  id: string;
  name: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mime: 'image/png';
}
export interface CanvasRecord {
  revision: number;
  document: CanvasDocument;
  assets: CanvasAsset[];
}
export const canvasSelectionSchema = z
  .object({ revision: z.number().int().min(0), nodeIds: z.array(id).max(8) })
  .strict();
export type CanvasSelection = z.infer<typeof canvasSelectionSchema>;
export interface CanvasSnapshot extends CanvasRecord {
  selectedIds: string[];
  contextIds: string[];
  sha256: string;
}
export const emptyCanvas = (): CanvasDocument => ({
  version: 1,
  nodes: [],
  layout: {},
});
export function canvasContext(
  document: CanvasDocument,
  roots: string[],
): CanvasNode[] {
  const selected = new Set<string>();
  const visit = (nodeId: string) => {
    if (selected.has(nodeId)) return;
    const node = document.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error('引用的节点已不存在，请重新选择。');
    selected.add(nodeId);
    node.references.forEach(visit);
  };
  roots.forEach(visit);
  return document.nodes.filter((n) => selected.has(n.id));
}
export const canvasAssetPath = (assetId: string) =>
  `assets/canvas/${assetId}.png`;
// JSONB changes object-key order. Hashing and merging must not treat that as an edit.
export function canvasJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

/**
 * Adapted from OhMyGame mergeCanvasDocument (Apache-2.0), commit 2cec05e4.
 * See third_party/ohmygame/NOTICE.md and LICENSE.
 * Changes: OpenGame node schema; separate layout; symmetric delete/edit conflict;
 * validation rejects dangling references rather than silently removing them.
 */
export function mergeCanvasDocument(
  base: CanvasDocument,
  local: CanvasDocument,
  remote: CanvasDocument,
): CanvasDocument | undefined {
  const equal = (a: unknown, b: unknown) => canvasJson(a) === canvasJson(b);
  const merge = <T>(a: T, b: T, c: T): T | undefined =>
    equal(b, c) || equal(a, c) ? b : equal(a, b) ? c : undefined;
  const nodes: CanvasNode[] = [];
  const layout: CanvasDocument['layout'] = {};
  for (const nodeId of new Set(
    [...local.nodes, ...remote.nodes].map((n) => n.id),
  )) {
    const before = base.nodes.find((n) => n.id === nodeId);
    const ours = local.nodes.find((n) => n.id === nodeId);
    const theirs = remote.nodes.find((n) => n.id === nodeId);
    if (before && (!ours || !theirs)) {
      const survivor = ours || theirs;
      if (
        survivor &&
        (!equal(before, survivor) ||
          !equal(base.layout[nodeId], (ours ? local : remote).layout[nodeId]))
      )
        return;
      continue;
    }
    if (!before || !ours || !theirs) {
      if (ours && theirs && !equal(ours, theirs)) return;
      nodes.push((ours || theirs)!);
      layout[nodeId] = (ours ? local : remote).layout[nodeId];
      continue;
    }
    if (before.type !== ours.type || ours.type !== theirs.type) return;
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(ours)) {
      const a = (before as Record<string, unknown>)[key];
      const b = (ours as Record<string, unknown>)[key];
      const c = (theirs as Record<string, unknown>)[key];
      if (!equal(a, b) && !equal(a, c) && !equal(b, c)) return;
      data[key] = merge(a, b, c);
    }
    const at = merge(
      base.layout[nodeId],
      local.layout[nodeId],
      remote.layout[nodeId],
    );
    if (!at) return;
    layout[nodeId] = at;
    nodes.push(data as CanvasNode);
  }
  const parsed = canvasDocumentSchema.safeParse({ version: 1, nodes, layout });
  return parsed.success ? parsed.data : undefined;
}
