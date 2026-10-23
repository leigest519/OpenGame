export interface GameLesson {
  title: string;
  tags: string[];
  appliesTo: string;
  advice: string;
  pitfalls: string;
}

export interface KnowledgeEntry extends GameLesson {
  id: string;
  origin: 'seed' | 'experience' | 'public';
  source: {
    label: string;
    reference: string;
    projectId?: string;
    versionId?: string;
  };
  verification: string;
  reusableModule?: string;
  always?: boolean;
  publicReleaseId?: string;
  publicReleaseNumber?: number;
}

export interface KnowledgeSnapshot {
  schemaVersion: 1;
  createdAt: string;
  sha256: string;
  entries: KnowledgeEntry[];
}
