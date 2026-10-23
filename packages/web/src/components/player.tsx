'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ellipsis,
  Maximize,
  Minimize,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  Eye,
  X,
} from 'lucide-react';
import { approvalLabel, type GameStats } from '@/shared/types';
import { AccountMenu } from './access-gate';
import { GameFrame, GameLoading } from './game-frame';

export function Player({ projectId }: { projectId: string }) {
  const playerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [game, setGame] = useState<{
    title: string;
    url: string;
    version: number;
  }>();
  const [stats, setStats] = useState<GameStats>();
  const [ratingBusy, setRatingBusy] = useState(false);
  const visit = useRef<{ projectId: string; id: string } | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenBusy, setFullscreenBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const updateFullscreen = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      setNotice('');
    };
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () =>
      document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  async function toggleFullscreen() {
    setNotice('');
    setMenuOpen(false);
    setFullscreenBusy(true);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (playerRef.current?.requestFullscreen) {
        await playerRef.current.requestFullscreen();
      } else {
        setNotice('当前浏览器不支持全屏，游戏已铺满窗口。');
      }
    } catch {
      setNotice('未能切换全屏，请再试一次。游戏仍可正常游玩。');
    } finally {
      setFullscreenBusy(false);
    }
  }
  const engage = useCallback(
    async (action: 'rating' | 'visit', body: unknown): Promise<GameStats> => {
      const response = await fetch(`/api/play/${projectId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (response.status === 401)
        window.dispatchEvent(new Event('opengame-session-expired'));
      if (!response.ok) throw new Error(data.error || '暂时无法保存，请重试。');
      return data;
    },
    [projectId],
  );
  async function rate(rating: -1 | 1) {
    if (ratingBusy || !stats) return;
    setRatingBusy(true);
    try {
      setStats(
        await engage('rating', {
          rating: stats.myRating === rating ? 0 : rating,
        }),
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setRatingBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    if (visit.current?.projectId !== projectId)
      visit.current = { projectId, id: crypto.randomUUID() };
    const visitId = visit.current.id;
    setGame(undefined);
    setStats(undefined);
    setError('');
    fetch(`/api/play/${projectId}`, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (r.status === 401)
          window.dispatchEvent(new Event('opengame-session-expired'));
        if (!r.ok) throw new Error(data.error);
        if (!active) return;
        setGame(data);
        setStats(data.stats);
        try {
          const updated = await engage('visit', { visitId });
          if (active)
            setStats((current) =>
              current ? { ...current, visits: updated.visits } : updated,
            );
        } catch (error) {
          if (active) setNotice((error as Error).message);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [projectId, engage]);
  return (
    <main
      className="player-page"
      ref={playerRef}
      aria-label={game?.title || '游戏'}
    >
      {game ? (
        <div className="player-viewport">
          <GameFrame
            key={reload}
            title={game.title}
            gameTitle={game.title}
            src={game.url}
            className="player-frame"
            onRetry={() => setReload((value) => value + 1)}
          />
        </div>
      ) : error ? (
        <section className="player-message">
          <h1>{error ? '暂时无法打开游戏' : '正在打开游戏…'}</h1>
          {error && <p role="alert">{error}</p>}
          {error && (
            <button className="button" onClick={() => window.location.reload()}>
              <RotateCcw size={16} />
              重试
            </button>
          )}
          <Link href="/">返回首页</Link>
        </section>
      ) : (
        <GameLoading />
      )}
      {game && stats && (
        <section className="game-engagement" aria-label="游戏评价与访问量">
          <button
            aria-label="点赞"
            title="点赞，再次点击取消"
            aria-pressed={stats.myRating === 1}
            disabled={ratingBusy}
            onClick={() => void rate(1)}
          >
            <ThumbsUp size={18} />
            <span>{stats.likes}</span>
          </button>
          <button
            aria-label="差评"
            title="差评，再次点击取消"
            aria-pressed={stats.myRating === -1}
            disabled={ratingBusy}
            onClick={() => void rate(-1)}
          >
            <ThumbsDown size={18} />
            <span>{stats.dislikes}</span>
          </button>
          <span aria-live="polite">{approvalLabel(stats)}</span>
          <span title="游戏页面访问次数">
            <Eye size={16} />
            {stats.visits.toLocaleString()} 次访问
          </span>
        </section>
      )}
      <div className="player-tools">
        {notice && (
          <p className="player-notice" role="status">
            {notice}
            <button aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </p>
        )}
        {menuOpen && (
          <section
            id="player-menu"
            className="player-menu-panel"
            aria-labelledby="player-menu-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setMenuOpen(false);
                menuButtonRef.current?.focus();
              }
            }}
          >
            <div className="player-menu-heading">
              <h1 id="player-menu-title">{game?.title || '游戏菜单'}</h1>
              <button
                className="icon-button"
                aria-label="关闭游戏菜单"
                onClick={() => {
                  setMenuOpen(false);
                  menuButtonRef.current?.focus();
                }}
              >
                <X size={18} />
              </button>
            </div>
            <button
              className="button"
              disabled={!game}
              onClick={() => {
                setReload((value) => value + 1);
                setMenuOpen(false);
                menuButtonRef.current?.focus();
              }}
            >
              <RotateCcw size={16} />
              重新载入游戏
            </button>
            <Link className="button" href="/">
              <ArrowLeft size={16} />
              返回首页
            </Link>
            <Link className="button" href="/marketplace">
              浏览所有作品
            </Link>
            <div className="player-account">
              <AccountMenu />
            </div>
          </section>
        )}
        <button
          className="player-tool-button"
          onClick={() => void toggleFullscreen()}
          disabled={!game || fullscreenBusy}
          aria-label={fullscreen ? '退出全屏' : '全屏游戏'}
          title={fullscreen ? '退出全屏（Esc）' : '全屏游戏'}
        >
          {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
          <span>{fullscreen ? '退出全屏' : '全屏'}</span>
        </button>
        <button
          ref={menuButtonRef}
          className="player-tool-button player-menu-toggle"
          aria-label="游戏菜单"
          title="游戏菜单"
          aria-expanded={menuOpen}
          aria-controls="player-menu"
          onClick={() => {
            setNotice('');
            setMenuOpen((value) => !value);
          }}
        >
          <Ellipsis size={19} />
        </button>
      </div>
    </main>
  );
}
