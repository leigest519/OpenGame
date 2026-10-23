'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import {
  ArrowUpRight,
  Check,
  FileText,
  ImagePlus,
  Link2,
  LoaderCircle,
  Minus,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import {
  canvasContext,
  canvasDocumentSchema,
  canvasJson,
  canvasLimits,
  emptyCanvas,
  mergeCanvasDocument,
  type CanvasAsset,
  type CanvasDocument,
  type CanvasNode,
  type CanvasRecord,
  type CanvasSelection,
} from '@/shared/canvas';

export interface CanvasHandle {
  attachImage(file: File): Promise<void>;
  prepareSubmission(): Promise<CanvasSelection>;
  revision(): number;
  hasChanges(): boolean;
  reload(): Promise<void>;
  clearSelection(): void;
}
export interface CanvasStatus {
  images?: Array<{ id: string; title: string }>;
  titles: string[];
  imageCount: number;
  dirty: boolean;
}
class CanvasRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event('opengame-session-expired'));
  if (!response.ok)
    throw new CanvasRequestError(
      value.error || '画布操作未完成，请重试。',
      response.status,
    );
  return value;
}
const same = (a: unknown, b: unknown) => canvasJson(a) === canvasJson(b);

export const DesignCanvas = forwardRef<
  CanvasHandle,
  {
    projectId: string;
    memberId?: string;
    historicalVersion?: { id: string; number: number };
    locked: boolean;
    onStatus: (status: CanvasStatus) => void;
  }
>(({ projectId, memberId, historicalVersion, locked, onStatus }, ref) => {
  const url = `/api/projects/${projectId}/canvas`;
  const storageKey = `opengame-canvas-${memberId || 'local'}-${projectId}`;
  const [base, setBase] = useState<CanvasRecord>();
  const [document, setDocument] = useState<CanvasDocument>(emptyCanvas);
  const [assets, setAssets] = useState<CanvasAsset[]>([]);
  const [historical, setHistorical] = useState<CanvasRecord>();
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<string>();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [zoom, setZoom] = useState(0.85);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState<CanvasRecord>();
  const working = useRef(false);
  const upload = useRef<HTMLInputElement>(null);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    startX: number;
    startY: number;
  }>(null);
  const dirty = !!base && !same(document, base.document);
  const readonly = !!historicalVersion;
  const board = readonly ? historical?.document || emptyCanvas() : document;
  const library = readonly ? historical?.assets || [] : assets;
  const node = board.nodes.find((n) => n.id === active);
  const disabled = busy || locked || !base || readonly;

  const load = useCallback(
    async (recover = false) => {
      const remote = await request<CanvasRecord>(url);
      setBase(remote);
      setAssets(remote.assets);
      setConflict(undefined);
      setError('');
      let local = remote.document;
      if (recover) {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
          if (
            saved &&
            canvasDocumentSchema.safeParse(saved.document).success &&
            canvasDocumentSchema.safeParse(saved.base).success
          ) {
            const merged = mergeCanvasDocument(
              saved.base,
              saved.document,
              remote.document,
            );
            local = merged || saved.document;
            if (!merged) setConflict(remote);
            if (Array.isArray(saved.selected))
              setSelected(
                saved.selected
                  .filter(
                    (id: unknown) =>
                      typeof id === 'string' &&
                      local.nodes.some((n) => n.id === id),
                  )
                  .slice(0, 8),
              );
            if (!same(local, remote.document))
              setNotice('已找回这台设备上未保存的设计。');
          }
        } catch {
          /* A corrupt or unavailable browser draft must not hide the server copy. */
        }
      } else setSelected([]);
      setDocument(local);
    },
    [url, storageKey],
  );
  useEffect(() => {
    void load(true).catch((e) => setError(e.message));
  }, [load]);
  const historicalVersionId = historicalVersion?.id;
  useEffect(() => {
    setHistorical(undefined);
    setActive(undefined);
    if (!historicalVersionId) return;
    let alive = true;
    void request<CanvasRecord>(`${url}?versionId=${historicalVersionId}`)
      .then((value) => {
        if (alive) setHistorical(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [historicalVersionId, url]);
  useEffect(() => {
    if (!base) return;
    try {
      if (dirty || selected.length)
        localStorage.setItem(
          storageKey,
          JSON.stringify({ base: base.document, document, selected }),
        );
      else localStorage.removeItem(storageKey);
    } catch {
      setNotice('浏览器无法保存临时草稿，请及时点击“保存画布”。');
    }
  }, [base, document, dirty, selected, storageKey]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const context = canvasContext(
      document,
      selected.filter((id) => document.nodes.some((n) => n.id === id)),
    );
    onStatus({
      titles: selected.flatMap(
        (id) => document.nodes.find((n) => n.id === id)?.title || [],
      ),
      imageCount: new Set(
        context.flatMap((n) => (n.type === 'image' ? [n.assetId] : [])),
      ).size,
      images: context.flatMap((n) =>
        n.type === 'image' ? [{ id: n.assetId, title: n.title }] : [],
      ),
      dirty,
    });
  }, [document, selected, dirty, onStatus]);

  async function save(): Promise<CanvasRecord> {
    if (!base) throw new Error('画布还没有加载完成，请稍后重试。');
    if (working.current) throw new Error('请等待当前画布操作完成。');
    if (conflict) throw new Error('画布存在不同修改，请先选择如何保留。');
    const parsed = canvasDocumentSchema.safeParse(document);
    if (!parsed.success)
      throw new Error(parsed.error.issues[0]?.message || '请检查画布内容。');
    working.current = true;
    setBusy(true);
    setError('');
    try {
      let saved: CanvasRecord;
      try {
        saved = await request(url, {
          revision: base.revision,
          document: parsed.data,
        });
      } catch (e) {
        if (!(e instanceof CanvasRequestError) || e.status !== 409) throw e;
        const remote = await request<CanvasRecord>(url);
        const merged = mergeCanvasDocument(
          base.document,
          parsed.data,
          remote.document,
        );
        if (!merged) {
          setConflict(remote);
          throw new Error('同一内容在另一处被修改，你的草稿已保留。');
        }
        saved = await request(url, {
          revision: remote.revision,
          document: merged,
        });
        setNotice('已合并另一处对不同内容的修改。');
      }
      setBase(saved);
      setDocument(saved.document);
      setAssets(saved.assets);
      setSelected((ids) =>
        ids.filter((id) => saved.document.nodes.some((n) => n.id === id)),
      );
      return saved;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  useImperativeHandle(ref, () => ({
    async attachImage(file) {
      await uploadImage(file, true);
    },
    async prepareSubmission() {
      const saved = await save();
      const nodeIds = selected.filter((id) =>
        saved.document.nodes.some((n) => n.id === id),
      );
      if (nodeIds.length !== selected.length)
        throw new Error('部分引用已在另一处移除，请检查后重新提交。');
      const context = canvasContext(saved.document, nodeIds);
      if (
        new Set(context.flatMap((n) => (n.type === 'image' ? [n.assetId] : [])))
          .size > canvasLimits.selectedImages
      )
        throw new Error('一次制作最多引用 4 张图片，请减少选中内容。');
      return { revision: saved.revision, nodeIds };
    },
    revision() {
      if (!base) throw new Error('画布还没有加载完成。');
      return base.revision;
    },
    hasChanges() {
      return dirty;
    },
    async reload() {
      await load();
    },
    clearSelection() {
      setSelected([]);
    },
  }));
  function change(next: CanvasDocument) {
    setDocument(next);
    setNotice('');
  }
  function updateNode(next: CanvasNode) {
    change({
      ...document,
      nodes: document.nodes.map((n) => (n.id === next.id ? next : n)),
    });
  }
  function add(next: CanvasNode) {
    if (document.nodes.length >= canvasLimits.nodes) {
      setError('一张画布最多放置 24 个内容。');
      return;
    }
    const index = document.nodes.length;
    change({
      ...document,
      nodes: [...document.nodes, next],
      layout: {
        ...document.layout,
        [next.id]: {
          x: 42 + (index % 3) * 290,
          y: 48 + Math.floor(index / 3) * 300,
        },
      },
    });
    setActive(next.id);
  }
  function addAsset(asset: CanvasAsset, reference = false) {
    const id = crypto.randomUUID();
    add({
      id,
      type: 'image',
      title: asset.name,
      assetId: asset.id,
      description: '',
      references: [],
    });
    if (reference) setSelected((ids) => [...ids, id]);
  }
  async function uploadImage(file?: File, reference = false) {
    if (!file) return;
    if (disabled || working.current)
      throw new Error('资料正在加载或保存，请稍后再添加图片。');
    if (document.nodes.length >= canvasLimits.nodes)
      throw new Error('项目资料已满，请先整理已有素材。');
    if (
      reference &&
      (selected.length >= 8 ||
        canvasContext(document, selected).filter((n) => n.type === 'image')
          .length >= 4)
    )
      throw new Error('本轮最多引用 4 张图片，请先移除一些引用。');
    if (file.size > canvasLimits.assetBytes) {
      throw new Error('单张图片不能超过 2 MB。');
    }
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('无法读取图片。'));
        reader.readAsDataURL(file);
      });
      const asset = await request<CanvasAsset>(`${url}/assets`, {
        name: file.name.slice(0, 80),
        data,
      });
      setAssets((list) =>
        list.some((a) => a.id === asset.id) ? list : [...list, asset],
      );
      addAsset(asset, reference);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      working.current = false;
      setBusy(false);
      if (upload.current) upload.current.value = '';
    }
  }
  function reference(targetId: string, enabled: boolean) {
    if (!node) return;
    const updated = {
      ...node,
      references: enabled
        ? [...node.references, targetId]
        : node.references.filter((id) => id !== targetId),
    };
    const next = {
      ...document,
      nodes: document.nodes.map((n) => (n.id === node.id ? updated : n)),
    };
    const valid = canvasDocumentSchema.safeParse(next);
    if (!valid.success) {
      setError(valid.error.issues[0]?.message || '无法引用这个内容。');
      return;
    }
    setError('');
    change(next);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || disabled) return;
    const x = Math.round(
      Math.max(
        0,
        Math.min(3600, current.x + (event.clientX - current.startX) / zoom),
      ),
    );
    const y = Math.round(
      Math.max(
        0,
        Math.min(2400, current.y + (event.clientY - current.startY) / zoom),
      ),
    );
    setDocument((previous) => ({
      ...previous,
      layout: { ...previous.layout, [current.id]: { x, y } },
    }));
  }
  const width = Math.max(
    1100,
    ...Object.values(board.layout).map((p) => p.x + 290),
  );
  const height = Math.max(
    750,
    ...Object.values(board.layout).map((p) => p.y + 300),
  );
  return (
    <div className="design-canvas" aria-label="设计画布">
      <div className="canvas-actions">
        {readonly ? (
          <strong>版本 {historicalVersion.number} 的设计 · 只读</strong>
        ) : (
          <>
            <button
              className="button"
              disabled={disabled}
              onClick={() =>
                add({
                  id: crypto.randomUUID(),
                  title: '玩法说明',
                  type: 'document',
                  text: '',
                  references: [],
                })
              }
            >
              <Plus size={14} /> 设计说明
            </button>
            <button
              className="button"
              disabled={disabled || board.nodes.length >= canvasLimits.nodes}
              onClick={() => upload.current?.click()}
            >
              <ImagePlus size={14} /> 上传图片
            </button>
            <input
              ref={upload}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label="上传参考图片"
              onChange={(e) =>
                void uploadImage(e.target.files?.[0]).catch((e) =>
                  setError(e.message),
                )
              }
            />
            <button
              className="button canvas-save"
              disabled={disabled || !dirty || !!conflict}
              onClick={() =>
                void save()
                  .then(() => setNotice('画布已保存。'))
                  .catch((e) => setError(e.message))
              }
            >
              {busy ? (
                <LoaderCircle size={14} className="spin" />
              ) : dirty ? (
                <Save size={14} />
              ) : (
                <Check size={14} />
              )}
              {dirty ? '保存画布' : '已保存'}
            </button>
            <button
              className="button"
              aria-pressed={libraryOpen}
              onClick={() => {
                setActive(undefined);
                setLibraryOpen((value) => !value);
              }}
            >
              素材库
            </button>
          </>
        )}
        <div className="canvas-zoom">
          <button
            aria-label="缩小画布"
            onClick={() => setZoom((v) => Math.max(0.45, v - 0.1))}
          >
            <Minus size={13} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="放大画布"
            onClick={() => setZoom((v) => Math.min(1.25, v + 0.1))}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      {error && (
        <div className="canvas-alert" role="alert">
          {error}
          <button aria-label="关闭画布提示" onClick={() => setError('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {conflict && (
        <div className="canvas-conflict">
          另一处也修改了相同内容。请先决定保留哪一份，再保存。
          <button
            onClick={() => {
              setBase(conflict);
              setAssets(conflict.assets);
              setConflict(undefined);
              setError('');
            }}
          >
            保留我的草稿
          </button>
          <button
            onClick={() => {
              setBase(conflict);
              setDocument(conflict.document);
              setAssets(conflict.assets);
              setSelected([]);
              setConflict(undefined);
              setError('');
            }}
          >
            使用服务器版本
          </button>
        </div>
      )}
      {notice && (
        <div className="canvas-notice" role="status">
          {notice}
        </div>
      )}
      <div
        className={`canvas-body ${node || libraryOpen ? '' : 'inspector-closed'}`}
      >
        <div className="canvas-viewport" aria-label="画布内容，可滚动查看">
          {!board.nodes.length ? (
            <div className="canvas-empty">
              <span>
                <FileText size={25} />
                <Link2 size={16} />
                <ImagePlus size={25} />
              </span>
              <h3>
                {readonly
                  ? historical
                    ? '这个版本还没有设计画布'
                    : '正在读取设计…'
                  : '把想法和参考图放在一起'}
              </h3>
              <p>
                {readonly
                  ? '较早的游戏版本仍然可以正常试玩。'
                  : '添加设计说明，引用角色或场景图片，再带入对话制作。'}
              </p>
              {!readonly && (
                <small>支持 PNG / JPEG · 单张 2 MB · 最多 400 万像素</small>
              )}
            </div>
          ) : (
            <div
              className="canvas-scroll-size"
              style={{ width: width * zoom, height: height * zoom }}
            >
              <div
                className="canvas-board"
                style={{ width, height, transform: `scale(${zoom})` }}
              >
                <svg
                  className="canvas-connections"
                  width={width}
                  height={height}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id={`arrow-${projectId}`}
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#a499c3" />
                    </marker>
                  </defs>
                  {board.nodes.flatMap((n) =>
                    n.references.map((target) => {
                      const a = board.layout[n.id];
                      const b = board.layout[target];
                      if (!a || !b) return null;
                      const horizontal =
                        Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
                      const startX = horizontal
                        ? a.x + (b.x >= a.x ? 256 : 0)
                        : a.x + 128;
                      const endX = horizontal
                        ? b.x + (b.x >= a.x ? 0 : 256)
                        : b.x + 128;
                      const startY = horizontal
                        ? a.y + 126
                        : a.y + (b.y >= a.y ? 258 : 0);
                      const endY = horizontal
                        ? b.y + 126
                        : b.y + (b.y >= a.y ? 0 : 258);
                      return (
                        <path
                          key={`${n.id}-${target}`}
                          d={`M${startX},${startY} C${startX},${(startY + endY) / 2} ${endX},${(startY + endY) / 2} ${endX},${endY}`}
                          stroke="#a499c3"
                          strokeWidth="2"
                          fill="none"
                          markerEnd={`url(#arrow-${projectId})`}
                        />
                      );
                    }),
                  )}
                </svg>
                {board.nodes.map((item) => (
                  <article
                    key={item.id}
                    className={`canvas-card ${active === item.id ? 'is-active' : ''} ${!readonly && selected.includes(item.id) ? 'is-referenced' : ''}`}
                    style={{
                      left: board.layout[item.id].x,
                      top: board.layout[item.id].y,
                    }}
                  >
                    <button
                      className="canvas-card-heading"
                      onClick={() => setActive(item.id)}
                      onPointerDown={(e) => {
                        setActive(item.id);
                        if (disabled || e.button !== 0) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        drag.current = {
                          id: item.id,
                          ...board.layout[item.id],
                          startX: e.clientX,
                          startY: e.clientY,
                        };
                      }}
                      onPointerMove={move}
                      onPointerUp={() => {
                        drag.current = null;
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                      }}
                      title={
                        readonly ? item.title : '拖动标题移动卡片；点击编辑'
                      }
                    >
                      {item.type === 'document' ? (
                        <FileText size={15} />
                      ) : (
                        <ImagePlus size={15} />
                      )}
                      <strong>{item.title || '未命名'}</strong>
                    </button>
                    <button
                      className="canvas-card-content"
                      aria-label={`查看 ${item.title}`}
                      onClick={() => setActive(item.id)}
                    >
                      {item.type === 'image' ? (
                        <img
                          src={`${url}/assets/${item.assetId}`}
                          alt={item.description || item.title}
                          draggable={false}
                        />
                      ) : (
                        <p>{item.text || '点击写下玩法、规则和美术方向…'}</p>
                      )}
                    </button>
                    <div className="canvas-card-footer">
                      <span>
                        {item.references.length
                          ? `引用 ${item.references.length} 项`
                          : item.type === 'image'
                            ? '参考素材'
                            : '设计说明'}
                      </span>
                      {!readonly && (
                        <button
                          disabled={disabled}
                          aria-pressed={selected.includes(item.id)}
                          onClick={() => {
                            if (
                              !selected.includes(item.id) &&
                              selected.length >= 8
                            ) {
                              setError('一次最多引用 8 个内容。');
                              return;
                            }
                            setSelected((ids) =>
                              ids.includes(item.id)
                                ? ids.filter((id) => id !== item.id)
                                : [...ids, item.id],
                            );
                          }}
                        >
                          {selected.includes(item.id) ? (
                            <Check size={13} />
                          ) : (
                            <ArrowUpRight size={13} />
                          )}
                          {selected.includes(item.id) ? '已引用' : '引用到对话'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside className="canvas-inspector" hidden={!node && !libraryOpen}>
          {node ? (
            <>
              <div className="canvas-inspector-heading">
                <strong>{readonly ? '查看内容' : '编辑内容'}</strong>
                <button
                  aria-label="关闭内容编辑"
                  onClick={() => {
                    setActive(undefined);
                    setLibraryOpen(false);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <fieldset disabled={disabled}>
                <label>
                  标题
                  <input
                    maxLength={80}
                    value={node.title}
                    onChange={(e) =>
                      updateNode({ ...node, title: e.target.value })
                    }
                  />
                </label>
                {node.type === 'document' ? (
                  <label>
                    设计说明
                    <textarea
                      value={node.text}
                      maxLength={8000}
                      rows={9}
                      placeholder="描述玩法、美术方向，以及这些参考图应该如何使用…"
                      onChange={(e) =>
                        updateNode({ ...node, text: e.target.value })
                      }
                    />
                  </label>
                ) : (
                  <>
                    <img
                      className="canvas-inspector-image"
                      src={`${url}/assets/${node.assetId}`}
                      alt={node.title}
                    />
                    <label>
                      如何使用这张图
                      <textarea
                        value={node.description}
                        rows={4}
                        maxLength={1000}
                        placeholder="例如：用作玩家角色，保持透明背景和原有配色。"
                        onChange={(e) =>
                          updateNode({ ...node, description: e.target.value })
                        }
                      />
                    </label>
                    <small>
                      {library.find((a) => a.id === node.assetId)?.width} ×{' '}
                      {library.find((a) => a.id === node.assetId)?.height} · PNG
                    </small>
                  </>
                )}
                <div className="canvas-reference-list">
                  <strong>
                    <Link2 size={13} /> 引用其他内容
                  </strong>
                  <small>带入对话时，这些内容也会一起提供。</small>
                  {board.nodes
                    .filter((n) => n.id !== node.id)
                    .map((other) => (
                      <label key={other.id}>
                        <input
                          type="checkbox"
                          checked={node.references.includes(other.id)}
                          onChange={(e) =>
                            reference(other.id, e.target.checked)
                          }
                        />
                        {other.title}
                      </label>
                    ))}
                  {board.nodes.length < 2 && (
                    <p>添加另一份说明或图片后即可引用。</p>
                  )}
                </div>
                {!readonly && (
                  <button
                    className="canvas-remove"
                    onClick={() => {
                      const next = {
                        ...document,
                        layout: { ...document.layout },
                        nodes: document.nodes
                          .filter((n) => n.id !== node.id)
                          .map((n) => ({
                            ...n,
                            references: n.references.filter(
                              (id) => id !== node.id,
                            ),
                          })),
                      };
                      delete next.layout[node.id];
                      change(next);
                      setSelected((ids) => ids.filter((id) => id !== node.id));
                      setActive(undefined);
                    }}
                  >
                    <Trash2 size={13} /> 从画布移除
                  </button>
                )}
              </fieldset>
            </>
          ) : (
            <div className="canvas-guidance">
              <span className="eyebrow">从设计到试玩</span>
              <h3>让参考有迹可循</h3>
              <ol>
                <li>放入玩法说明和参考图</li>
                <li>点击卡片，关联参考内容</li>
                <li>引用到对话，描述本次修改</li>
              </ol>
              <p>提交时会固定一份画布，和这次游戏版本一起保存。</p>
            </div>
          )}
          {!readonly &&
            library.some(
              (a) =>
                !board.nodes.some(
                  (n) => n.type === 'image' && n.assetId === a.id,
                ),
            ) && (
              <details className="canvas-library" open={libraryOpen}>
                <summary>项目素材库</summary>
                <p>移出画布的素材仍可再次使用。</p>
                {library
                  .filter(
                    (a) =>
                      !board.nodes.some(
                        (n) => n.type === 'image' && n.assetId === a.id,
                      ),
                  )
                  .map((asset) => (
                    <button
                      key={asset.id}
                      disabled={disabled}
                      onClick={() => addAsset(asset)}
                    >
                      <img src={`${url}/assets/${asset.id}`} alt="" />
                      {asset.name}
                      <Plus size={13} />
                    </button>
                  ))}
              </details>
            )}
        </aside>
      </div>
      <div className="canvas-status">
        <span>
          {readonly
            ? '跟随游戏版本保存的设计快照'
            : dirty
              ? '有未保存的设计 · 提交制作时会自动保存'
              : '设计草稿已保存 · 提交制作后归入游戏版本'}
        </span>
        <span>
          {board.nodes.length} / {canvasLimits.nodes} 项
        </span>
      </div>
    </div>
  );
});

DesignCanvas.displayName = 'DesignCanvas';
