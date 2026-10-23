import type { GameLesson, KnowledgeEntry } from './knowledge';

export interface EvolutionCandidate {
  id: string;
  lesson: GameLesson;
  contentHash: string;
  status: 'pending' | 'reviewed' | 'rejected';
  reviewNote: string;
  sourceLabel: string;
  createdAt: string;
}
export interface ReleaseEntry extends GameLesson {
  candidateId: string;
}
export interface RegressionCaseResult {
  id: string;
  title: string;
  passed: boolean;
  tests: Array<{ name: string; passed: boolean }>;
  durationMs: number;
}
export interface RegressionReport {
  suiteHash: string;
  contentHash: string;
  checkedAt: string;
  passed: boolean;
  scope: 'reference-rules';
  environment: { kind: 'docker'; image: string };
  cases: RegressionCaseResult[];
}
export interface KnowledgeRelease {
  id: string;
  number: number;
  label: string;
  baseReleaseId: string | null;
  status: 'queued' | 'running' | 'passed' | 'failed';
  entries: ReleaseEntry[];
  contentHash: string;
  suiteHash: string;
  report: RegressionReport | null;
  error: string | null;
  createdAt: string;
  publishedAt: string | null;
}
export interface EvolutionOverview {
  canReview: boolean;
  activeReleaseId: string | null;
  candidates: EvolutionCandidate[];
  releases: KnowledgeRelease[];
  sources: KnowledgeEntry[];
  benchmarks: Array<{ id: string; title: string; testCount: number }>;
}
