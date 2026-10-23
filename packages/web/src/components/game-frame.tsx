'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Gamepad2, RotateCcw } from 'lucide-react';
import styles from './game-frame.module.css';

export function GameLoading({
  title,
  slow = false,
  leaving = false,
  onRetry,
  standaloneUrl,
}: {
  title?: string;
  slow?: boolean;
  leaving?: boolean;
  onRetry?: () => void;
  standaloneUrl?: string;
}) {
  return (
    <div
      className={`${styles.loading} ${leaving ? styles.leaving : ''}`}
      aria-hidden={leaving || undefined}
    >
      <div className={styles.content}>
        <div className={styles.emblem} aria-hidden="true">
          <span className={styles.halo} />
          <span className={styles.orbit} />
          <span className={styles.logo}>
            <Gamepad2 size={38} strokeWidth={1.7} />
          </span>
          <span className={styles.spark} />
        </div>
        <div className={styles.brand}>OpenGame</div>
        <p className={styles.tagline}>让想法，成为可玩的游戏</p>
        <div className={styles.status} role="status" aria-live="polite">
          <p className={styles.title}>
            {title ? `正在加载《${title}》` : '正在打开游戏'}
          </p>
          <div className={styles.track} aria-hidden="true">
            <span />
          </div>
          <p className={styles.hint}>
            {slow
              ? '加载比平时久，可以重新加载，或单独打开游戏。'
              : '准备好后，游戏会自动出现'}
          </p>
        </div>
        {slow && onRetry && !leaving && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            <RotateCcw size={15} />
            重新加载
          </button>
        )}
        {slow && standaloneUrl && !leaving && (
          <a
            className={styles.retry}
            href={standaloneUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={15} />
            单独打开游戏
          </a>
        )}
      </div>
      <span className={styles.signature} aria-hidden="true">
        MADE OF IDEAS. READY TO PLAY.
      </span>
    </div>
  );
}

type GameFrameProps = {
  src: string;
  title: string;
  gameTitle?: string;
  className?: string;
  onRetry: () => void;
};

// Changing the source starts a fresh loading lifecycle. Resizing or entering
// fullscreen keeps this iframe mounted, preserving the player's current game.
export function GameFrame(props: GameFrameProps) {
  return <LoadingGameFrame key={props.src} {...props} />;
}

function LoadingGameFrame({
  src,
  title,
  gameTitle,
  className,
  onRetry,
}: GameFrameProps) {
  const [phase, setPhase] = useState<'loading' | 'leaving' | 'ready'>(
    'loading',
  );
  const [slow, setSlow] = useState(false);
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(
    () => () => {
      clearTimeout(fade.current);
    },
    [],
  );

  function reveal() {
    clearTimeout(fade.current);
    // load already waits for the game's synchronous startup and resources.
    // Never gate access on animation frames: embedded/background browsers may
    // suspend them even after the game has finished loading.
    setPhase('leaving');
    fade.current = setTimeout(() => setPhase('ready'), 200);
  }

  return (
    <div className={styles.frame} aria-busy={phase === 'loading'}>
      <iframe
        title={title}
        src={src}
        sandbox="allow-scripts"
        allow="fullscreen"
        allowFullScreen
        className={className}
        tabIndex={phase === 'loading' ? -1 : 0}
        aria-hidden={phase === 'loading' || undefined}
        onLoad={reveal}
        onError={() => setSlow(true)}
      />
      {phase !== 'ready' && (
        <GameLoading
          title={gameTitle}
          slow={slow}
          leaving={phase === 'leaving'}
          onRetry={onRetry}
          standaloneUrl={src}
        />
      )}
    </div>
  );
}
