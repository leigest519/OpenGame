// Fixed by the platform, never supplied as arbitrary paths by generated games.
export const qualityScreenshots = [
  {
    file: 'preview-start.png',
    label: '开始后的主画面',
    width: 960,
    height: 600,
  },
  { file: 'preview.png', label: '实际操作后的画面', width: 960, height: 600 },
  {
    file: 'preview-wide.png',
    label: '宽屏中的同一局',
    width: 1440,
    height: 800,
  },
  {
    file: 'preview-compact.png',
    label: '窄屏中的同一局',
    width: 700,
    height: 520,
  },
] as const;
export const acceptanceScreenshots = Array.from(
  { length: 8 },
  (_, i) => `acceptance-${i}.png`,
);

export interface GameQualityReport {
  screenshots: Array<{
    file: string;
    label: string;
    width: number;
    height: number;
  }>;
  playtest: { status: 'passed' | 'missing'; steps: number };
  warnings: string[];
  // Historical 0.3 marker: never a visual-quality score.
  reviewed?: boolean;
  acceptance?: Array<import('./game-production').AcceptanceResult>;
  production?: import('./game-production').ProductionReport;
}

export type PlaytestStep =
  | { action: 'click'; selector: string; x?: number; y?: number }
  | { action: 'key'; key: string; holdMs: number }
  | { action: 'wait'; ms: number }
  | { action: 'focus'; target: 'away' | 'game' }
  | { action: 'expect'; selector: string; text?: string; exact?: boolean };

export interface PlaytestPlan {
  version: 1;
  steps: PlaytestStep[];
}
