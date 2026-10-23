import type { GameLesson } from './knowledge';
import type { CanvasSnapshot } from './canvas';
import type { DevelopmentPlan } from './development';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export type Phase =
  | 'queued'
  | 'planning'
  | 'preparing'
  | 'generating'
  | 'validating'
  | 'saving'
  | 'done';
export interface Project {
  media_kind?: 'game' | 'image';
  id: string;
  owner_id?: string | null;
  likes?: number;
  dislikes?: number;
  visits?: number;
  previewUrl?: string;
  title: string;
  description: string;
  source: 'generated' | 'sample';
  latest_version_id: string | null;
  released_version_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface ValidationReport {
  quality?: import('./game-quality').GameQualityReport;
  images?: Array<{
    file: string;
    label: string;
    batchIndex: number;
    width: number;
    height: number;
    format: string;
  }>;
  image?: { width: number; height: number; format: string };
  build: boolean;
  browser: boolean;
  start: boolean;
  restart: boolean;
  errors: string[];
  checkedAt: string;
  environment?: { kind: 'docker'; projectId: string; image: string };
}
export interface GameVersion {
  development_plan?: DevelopmentPlan | null;
  canvas_snapshot?: CanvasSnapshot | null;
  id: string;
  previewUrl?: string;
  project_id: string;
  number: number;
  commit_sha: string;
  artifact_key: string;
  summary: string;
  kind: 'generated' | 'sample' | 'restore';
  source_version_id: string | null;
  standards_version: string;
  validation: ValidationReport;
  created_at: string;
}
export interface Job {
  image_batch_id?: string | null;
  image_batch_index?: number | null;
  image_reference_version_id?: string | null;
  image_asset_id?: string | null;
  model?: import('./models').GenerationModel;
  kind?: 'chat' | 'build';
  plan?: DevelopmentPlan | null;
  planning_reply?: string | null;
  result_version_id?: string | null;
  canvas_snapshot?: CanvasSnapshot | null;
  id: string;
  project_id: string;
  base_version_id: string | null;
  prompt: string;
  status: JobStatus;
  phase: Phase;
  cancel_requested: boolean;
  attempt: number;
  lease_token: string | null;
  prepared: PreparedVersion | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}
export interface PreparedVersion {
  id: string;
  title?: string;
  commitSha: string;
  artifactKey: string;
  artifactHash: string;
  summary: string;
  standardsVersion: string;
  validation: ValidationReport;
  lessons?: GameLesson[];
  learningNote?: string;
}
export interface JobEvent {
  id: number;
  phase: Phase;
  message: string;
  created_at: string;
}
export interface Message {
  job_id?: string | null;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
export interface ProjectDetail {
  imageBatches?: Array<import('./image-batch').ImageBatch>;
  project: Project;
  versions: GameVersion[];
  jobs: Job[];
  messages: Message[];
  events: JobEvent[];
  previewOrigin: string;
}
export const phaseLabels: Record<Phase, string> = {
  queued: '等待处理',
  planning: '梳理想法',
  preparing: '准备项目',
  generating: '正在制作',
  validating: '检查游戏',
  saving: '保存版本',
  done: '已完成',
};

export interface GameStats {
  likes: number;
  dislikes: number;
  visits: number;
  myRating: -1 | 0 | 1;
}
export function approvalLabel(
  stats: Pick<GameStats, 'likes' | 'dislikes'>,
): string {
  const total = stats.likes + stats.dislikes;
  return total
    ? `${Math.round((stats.likes / total) * 100)}% 好评`
    : '暂无评价';
}
