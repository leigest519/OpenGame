import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasContext,
  canvasDocumentSchema,
  canvasJson,
  emptyCanvas,
  mergeCanvasDocument,
  type CanvasDocument,
} from '../src/shared/canvas';

const initial = (): CanvasDocument => ({
  version: 1,
  nodes: [
    {
      id: 'brief',
      title: '玩法',
      type: 'document',
      text: '收集星星',
      references: ['art'],
    },
    {
      id: 'art',
      title: '美术方向',
      type: 'document',
      text: '清爽明亮',
      references: [],
    },
  ],
  layout: { brief: { x: 30, y: 40 }, art: { x: 340, y: 40 } },
});
test('a selected design includes its transitive references once and rejects cycles, dangling links and prototype keys', () => {
  const doc = initial();
  assert.deepEqual(
    canvasContext(doc, ['brief', 'art']).map((n) => n.id),
    ['brief', 'art'],
  );
  doc.nodes[1].references = ['brief'];
  assert.equal(canvasDocumentSchema.safeParse(doc).success, false);
  doc.nodes[1].references = ['missing'];
  assert.equal(canvasDocumentSchema.safeParse(doc).success, false);
  doc.nodes[1].references = [];
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.equal(
      canvasDocumentSchema.safeParse({
        ...doc,
        nodes: [{ ...doc.nodes[1], id: key }],
        layout: JSON.parse(`{"${key}":{"x":0,"y":0}}`),
      }).success,
      false,
    );
  }
});
test('independent content and layout changes merge, while conflicting changes and deletion preserve both drafts', () => {
  const base = initial(),
    local = initial(),
    remote = initial();
  local.nodes[0].title = '新玩法';
  remote.layout.brief = { x: 80, y: 90 };
  const combined = mergeCanvasDocument(base, local, remote)!;
  assert.equal(combined.nodes[0].title, '新玩法');
  assert.deepEqual(combined.layout.brief, remote.layout.brief);
  remote.nodes[0].title = '另一玩法';
  assert.equal(mergeCanvasDocument(base, local, remote), undefined);
  assert.equal(mergeCanvasDocument(base, local, emptyCanvas()), undefined);
  assert.equal(mergeCanvasDocument(base, emptyCanvas(), local), undefined);
  assert.deepEqual(
    mergeCanvasDocument(base, base, emptyCanvas()),
    emptyCanvas(),
  );
});
test('JSONB key order does not create edits or change a canvas digest', () => {
  const doc = initial();
  const shuffled = JSON.parse(
    JSON.stringify(doc, (_key, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse())
        : v,
    ),
  );
  assert.equal(canvasJson(doc), canvasJson(shuffled));
  assert.equal(
    canvasJson(mergeCanvasDocument(doc, doc, shuffled)),
    canvasJson(doc),
  );
  shuffled.nodes.reverse();
  assert.notEqual(canvasJson(doc), canvasJson(shuffled));
});
