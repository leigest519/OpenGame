'use client';
import { useEffect, useRef, useState } from 'react';
import type { ProjectDetail } from '../shared/types';
import type { CanvasSelection } from '../shared/canvas';
import { imageStylePresets } from '../shared/image-batch';

async function post(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || '操作失败，请重试。');
  return value;
}
export function ImageBatchPanel({
  detail,
  disabled,
  model,
  prepare,
  onRefresh,
  onView,
  onCurrent,
}: {
  detail: ProjectDetail;
  disabled: boolean;
  model: 'default' | 'gpt-6-astra';
  prepare: () => Promise<CanvasSelection | undefined>;
  onRefresh: () => Promise<unknown>;
  onView: (id: string) => void;
  onCurrent: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('保留主体与构图，尝试不同的视觉风格。');
  const [styles, setStyles] = useState('自然摄影\n电影质感\n水彩插画');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<{ content: string; key: string } | null>(null);
  const batch = detail.imageBatches?.[0];
  const active = batch?.status === 'active';
  const initializedBatch = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (batch && initializedBatch.current !== batch.id) {
      initializedBatch.current = batch.id;
      setPrompt(batch.prompt);
      setStyles(batch.styles.join('\n'));
    }
  }, [batch]);
  const items = styles
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const jobs = detail.jobs.filter((j) => j.image_batch_id === batch?.id);
  const completed = jobs.filter((j) => j.status === 'succeeded').length;
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const canvas = await prepare();
      const body = {
        prompt,
        styles: items,
        model,
        baseVersionId: detail.project.latest_version_id,
        ...(canvas ? { canvas } : {}),
      };
      const content = JSON.stringify(body);
      if (request.current?.content !== content)
        request.current = { content, key: crypto.randomUUID() };
      await post(`/api/projects/${detail.project.id}/image-batches`, {
        ...body,
        requestKey: request.current.key,
      });
      request.current = null;
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    setError('');
    try {
      await post(
        `/api/projects/${detail.project.id}/image-batches/${batch!.id}/cancel`,
        {},
      );
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="preview-toolbar" style={{ flexWrap: 'wrap' }}>
        <button className="button" onClick={() => setOpen(true)}>
          批量制作 · 多种风格
        </button>
        {batch && (
          <small role="status">
            {active
              ? '制作中'
              : batch.status === 'cancelled'
                ? '已停止'
                : batch.status === 'failed'
                  ? '批次中断'
                  : '批次完成'}{' '}
            · 已生成 {completed}/{batch.styles.length} 张
          </small>
        )}
        {active && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void cancel()}
          >
            停止整批
          </button>
        )}
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setOpen(false)}
        style={{
          width: 'min(900px,94vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div className="dialog-heading">
          <h2>批量制作图片</h2>
          <button className="button" onClick={() => setOpen(false)}>
            关闭
          </button>
        </div>
        <p>
          一次制作 2–6
          张，每种风格一张，全部保存在同一个版本中。各张使用本批开始时的同一原图；基于图片组继续制作时使用第一张作为参考。关掉页面也会继续制作。
        </p>
        <label style={{ display: 'block', marginTop: 16 }}>
          共同画面要求
          <textarea
            aria-label="批量画面要求"
            value={prompt}
            disabled={busy || active}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={4000}
            style={{ display: 'block', width: '100%', minHeight: 80 }}
          />
        </label>
        <p>风格预设（点击添加，也可以自行填写）</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {imageStylePresets.map((s) => (
            <button
              className="button"
              key={s}
              disabled={busy || active || items.length >= 6}
              onClick={() => setStyles((v) => v + '\n' + s)}
            >
              {s}
            </button>
          ))}
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>
          每行一种风格
          <textarea
            aria-label="批量风格列表"
            value={styles}
            disabled={busy || active}
            onChange={(e) => setStyles(e.target.value)}
            style={{ display: 'block', width: '100%', minHeight: 110 }}
          />
        </label>
        <p>
          将依次制作 {items.length}{' '}
          张，每张按一次制作计入额度；额度不足会停止，已完成图片保留。单张失败后继续下一张。
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          className="button"
          disabled={
            disabled ||
            busy ||
            active ||
            items.length < 2 ||
            items.length > 6 ||
            !prompt.trim() ||
            items.some((s) => s.length > 120)
          }
          onClick={() => void submit()}
        >
          开始批量制作 {items.length} 张
        </button>
        {batch && (
          <section style={{ marginTop: 24 }}>
            <h3>
              最近一批 · {completed}/{batch.styles.length} 张已完成
            </h3>
            {batch.error && <p role="alert">{batch.error}</p>}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                gap: 12,
              }}
            >
              {batch.styles.map((style, index) => {
                const job = jobs.find((j) => j.image_batch_index === index);
                const version = detail.versions.find(
                  (v) => v.id === job?.result_version_id,
                );
                const item =
                  version?.validation.images?.findIndex(
                    (i) => i.batchIndex === index,
                  ) ?? 0;
                return (
                  <article
                    key={index}
                    style={{
                      border: '1px solid #ddd',
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <strong>
                      {index + 1}. {style}
                    </strong>
                    <p>
                      {job?.status === 'succeeded'
                        ? '已完成'
                        : job?.status === 'failed'
                          ? '失败'
                          : job?.status === 'cancelled'
                            ? '已停止'
                            : job?.status === 'running'
                              ? '正在制作'
                              : batch.status === 'active'
                                ? '等待制作'
                                : '未制作'}
                    </p>
                    {job?.error && <small>{job.error}</small>}
                    {version && (
                      <>
                        <img
                          loading="lazy"
                          alt={`${style}批量结果`}
                          src={`/api/projects/${detail.project.id}/image-preview?versionId=${version.id}&item=${item}`}
                          style={{
                            width: '100%',
                            height: 180,
                            objectFit: 'contain',
                          }}
                        />
                        <div
                          style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
                        >
                          <button
                            className="button"
                            onClick={() => {
                              onView(version.id);
                              setOpen(false);
                            }}
                          >
                            查看版本 {version.number}
                          </button>
                          <button
                            className="button"
                            disabled={
                              disabled ||
                              busy ||
                              active ||
                              version.id === detail.project.latest_version_id
                            }
                            onClick={() => {
                              onCurrent(version.id);
                              setOpen(false);
                            }}
                          >
                            设为当前
                          </button>
                          <a
                            className="button"
                            href={`/api/projects/${detail.project.id}/image-download?versionId=${version.id}&item=${item}`}
                          >
                            下载 PNG
                          </a>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </dialog>
    </>
  );
}
