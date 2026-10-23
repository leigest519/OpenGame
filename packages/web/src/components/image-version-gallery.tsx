'use client';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  X,
} from 'lucide-react';
import type { GameVersion } from '../shared/types';
import styles from './image-version-gallery.module.css';

export function ImageVersionGallery({
  projectId,
  version,
  title,
}: {
  projectId: string;
  version: GameVersion;
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const images = version.validation.images;
  const count = images?.length || 1;
  const current = images?.[index];
  const preview = (item: number) =>
    `/api/projects/${projectId}/image-preview?versionId=${version.id}&item=${item}`;
  const move = (step: number) =>
    setIndex((value) => (value + step + count) % count);
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
    else dialog.current?.close();
  }, [expanded]);
  function keyboard(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || count < 2) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
  function swipe(event: TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4)
      move(dx < 0 ? 1 : -1);
  }
  if (!images?.length)
    return (
      <img
        alt={title}
        src={preview(0)}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    );
  function viewer(fullscreen: boolean) {
    return (
      <section
        className={`${styles.viewer} ${fullscreen ? styles.fullscreen : ''}`}
        aria-label={
          fullscreen ? '放大图片浏览' : `版本 ${version.number} 图片组`
        }
        aria-roledescription="轮播图"
        tabIndex={0}
        onKeyDown={keyboard}
      >
        <div
          className={styles.stage}
          onTouchStart={(event) => {
            touch.current =
              event.touches.length === 1
                ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
                : null;
          }}
          onTouchEnd={swipe}
          onTouchCancel={() => {
            touch.current = null;
          }}
        >
          <img
            className={styles.mainImage}
            src={preview(index)}
            alt={current!.label}
            draggable={false}
          />
          {count > 1 && (
            <>
              <button
                className={`${styles.arrow} ${styles.previous}`}
                aria-label="上一张图片"
                onClick={() => move(-1)}
              >
                <ChevronLeft size={24} />
              </button>
              <button
                className={`${styles.arrow} ${styles.next}`}
                aria-label="下一张图片"
                onClick={() => move(1)}
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}
          <span
            className={styles.counter}
            aria-live="polite"
            aria-atomic="true"
          >
            {index + 1} / {count}
          </span>
          <button
            className={styles.expand}
            aria-label={fullscreen ? '关闭大图' : '放大当前图片'}
            onClick={() => setExpanded(!fullscreen)}
          >
            {fullscreen ? <X size={19} /> : <Maximize2 size={18} />}
          </button>
        </div>
        <footer className={styles.footer}>
          <div className={styles.caption}>
            <strong title={current!.label}>
              {current!.label.split(/[：:]/)[0]}
            </strong>
            <a
              className={styles.download}
              href={`/api/projects/${projectId}/image-download?versionId=${version.id}&item=${index}`}
            >
              <Download size={15} />
              下载当前图片
            </a>
          </div>
          {count > 1 && (
            <div className={styles.thumbnails} aria-label="选择图片">
              {images!.map((item, i) => (
                <button
                  key={item.file}
                  className={styles.thumbnail}
                  aria-label={`查看第 ${i + 1} 张：${item.label.split(/[：:]/)[0]}`}
                  aria-pressed={i === index}
                  onClick={() => setIndex(i)}
                >
                  <img src={preview(i)} alt="" draggable={false} />
                  <span>{i + 1}</span>
                </button>
              ))}
            </div>
          )}
        </footer>
      </section>
    );
  }
  return (
    <>
      {viewer(false)}
      <dialog
        ref={dialog}
        className={styles.dialog}
        onCancel={() => setExpanded(false)}
        onClose={() => setExpanded(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setExpanded(false);
        }}
      >
        {expanded && viewer(true)}
      </dialog>
    </>
  );
}
