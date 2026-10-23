import { accessMode } from './config';
import type { Viewer } from './access';
import { StudioError } from './errors';

export function canReviewEvolution(viewer: Viewer | null): boolean {
  if (accessMode === 'local') return true;
  const reviewers = (process.env.OPENGAME_KNOWLEDGE_REVIEWERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return !!viewer && reviewers.includes(viewer.id);
}
export function requireEvolutionReviewer(viewer: Viewer | null): void {
  if (!canReviewEvolution(viewer))
    throw new StudioError('只有知识维护者可以审核和发布公共版本。', 403);
}
