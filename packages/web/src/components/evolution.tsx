'use client';

import Link from 'next/link';
import { startVisiblePolling } from '../client/visible-polling';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  FlaskConical,
  Gamepad2,
  GitBranch,
  ShieldCheck,
} from 'lucide-react';
import { AccountMenu } from './access-gate';
import type { GameLesson, KnowledgeEntry } from '@/shared/knowledge';
import type {
  EvolutionCandidate,
  EvolutionOverview,
  KnowledgeRelease,
} from '@/shared/evolution';

async function api<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/evolution${route}`,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event('opengame-session-expired'));
  if (!response.ok) throw new Error(result.error || '操作未完成，请重试。');
  return result;
}
const lessonOf = (entry: GameLesson): GameLesson => ({
  title: entry.title,
  tags: entry.tags,
  appliesTo: entry.appliesTo,
  advice: entry.advice,
  pitfalls: entry.pitfalls,
});
const emptyLesson: GameLesson = {
  title: '',
  tags: [],
  appliesTo: '',
  advice: '',
  pitfalls: '',
};

function ContributionForm({
  sources,
  busy,
  submit,
}: {
  sources: KnowledgeEntry[];
  busy: boolean;
  submit: (sourceId: string, lesson: GameLesson) => Promise<void>;
}) {
  const [source, setSource] = useState('');
  const [lesson, setLesson] = useState(emptyLesson);
  const [tags, setTags] = useState('');
  const [consent, setConsent] = useState(false);
  return (
    <form
      className="evolution-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await submit(source, {
          ...lesson,
          tags: tags
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean),
        });
      }}
    >
      <label>
        选择自己的项目经验
        <select
          required
          value={source}
          disabled={busy}
          onChange={(e) => {
            setSource(e.target.value);
            setConsent(false);
            const entry = sources.find((s) => s.id === e.target.value);
            setLesson(entry ? lessonOf(entry) : emptyLesson);
            setTags(entry?.tags.join('，') || '');
          }}
        >
          <option value="">请选择一条已保存的经验</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} · {s.source.label}
            </option>
          ))}
        </select>
      </label>
      {source && (
        <>
          <label>
            经验名称
            <input
              required
              maxLength={80}
              minLength={2}
              value={lesson.title}
              onChange={(e) => setLesson({ ...lesson, title: e.target.value })}
            />
          </label>
          <div className="evolution-form-pair">
            <label>
              适用条件
              <input
                required
                minLength={3}
                maxLength={240}
                value={lesson.appliesTo}
                onChange={(e) =>
                  setLesson({ ...lesson, appliesTo: e.target.value })
                }
              />
            </label>
            <label>
              关键词，用逗号分隔
              <input
                required
                maxLength={247}
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </label>
          </div>
          <label>
            可复用的做法
            <textarea
              required
              minLength={5}
              maxLength={900}
              rows={4}
              value={lesson.advice}
              onChange={(e) => setLesson({ ...lesson, advice: e.target.value })}
            />
          </label>
          <label>
            限制与易错点
            <textarea
              required
              minLength={3}
              maxLength={300}
              rows={2}
              value={lesson.pitfalls}
              onChange={(e) =>
                setLesson({ ...lesson, pitfalls: e.target.value })
              }
            />
          </label>
          <label className="evolution-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            将这段通用经验及来源提交给知识维护者；审核发布后，通用经验可供所有成员使用。
          </label>
          <p className="evolution-muted">
            请移除私人玩法细节、素材、个人信息和凭证。来源项目的源码与对话不会随公共经验公开。
          </p>
          <button className="button primary" disabled={busy || !consent}>
            提交经验候选
          </button>
        </>
      )}
      {!sources.length && (
        <p className="evolution-muted">
          完成一次游戏制作并保存新经验后，就可以在这里贡献。
        </p>
      )}
    </form>
  );
}

function CandidateCard({
  candidate,
  canReview,
  published,
  busy,
  review,
}: {
  candidate: EvolutionCandidate;
  canReview: boolean;
  published: boolean;
  busy: boolean;
  review: (
    candidate: EvolutionCandidate,
    decision: 'reviewed' | 'rejected',
    note: string,
  ) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const labels = {
    pending: '待内容审核',
    reviewed: '已审核 · 待发布',
    rejected: '未采纳',
  };
  return (
    <article className="knowledge-card evolution-candidate">
      <span
        className={`evolution-badge ${candidate.status === 'reviewed' ? 'good' : ''}`}
      >
        {published ? '当前公共版本已包含' : labels[candidate.status]}
      </span>
      <h3>{candidate.lesson.title}</h3>
      <p className="evolution-muted">适用于：{candidate.lesson.appliesTo}</p>
      <p>{candidate.lesson.advice}</p>
      <p className="knowledge-pitfalls">注意：{candidate.lesson.pitfalls}</p>
      <div className="knowledge-tags">
        {candidate.lesson.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <p className="evolution-muted">来源：{candidate.sourceLabel}</p>
      {candidate.reviewNote && (
        <p className="evolution-note">审核记录：{candidate.reviewNote}</p>
      )}
      {canReview && candidate.status === 'pending' && (
        <div className="evolution-form">
          <label>
            审核依据
            <textarea
              rows={2}
              minLength={5}
              maxLength={800}
              placeholder="说明证据、适用范围，以及仍未验证的部分"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="evolution-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            已核对通用性、来源和私人信息；经验不包含修改权限或绕过验收的指令。
          </label>
          <div className="evolution-actions">
            <button
              className="button primary"
              disabled={busy || !checked || note.trim().length < 5}
              onClick={() => void review(candidate, 'reviewed', note)}
            >
              通过内容审核
            </button>
            <button
              className="button"
              disabled={busy || !checked || note.trim().length < 5}
              onClick={() => void review(candidate, 'rejected', note)}
            >
              暂不采纳
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function ReleaseCard({
  release,
  activeId,
  canReview,
  busy,
  activate,
}: {
  release: KnowledgeRelease;
  activeId: string | null;
  canReview: boolean;
  busy: boolean;
  activate: (id: string | null) => Promise<void>;
}) {
  const active = release.id === activeId;
  const states = {
    queued: '等待复验',
    running: '正在复验',
    passed: '回归通过',
    failed: '复验未通过',
  };
  const total =
    release.report?.cases.reduce((n, c) => n + c.tests.length, 0) || 0;
  const passed =
    release.report?.cases.reduce(
      (n, c) => n + c.tests.filter((t) => t.passed).length,
      0,
    ) || 0;
  return (
    <article className={`evolution-release ${active ? 'is-active' : ''}`}>
      <div className="evolution-release-heading">
        <div>
          <span className={`evolution-badge ${active ? 'good' : ''}`}>
            {active
              ? '当前生效'
              : release.publishedAt
                ? '历史公共版本'
                : states[release.status]}
          </span>
          <h3>
            v{release.number} · {release.label}
          </h3>
        </div>
        <span className="evolution-muted">{release.entries.length} 条经验</span>
      </div>
      <ul className="evolution-lessons">
        {release.entries.map((entry) => (
          <li key={entry.candidateId}>{entry.title}</li>
        ))}
      </ul>
      {release.report && (
        <details>
          <summary>
            参照样例回归 · {passed}/{total} 组通过
          </summary>
          <div className="evolution-test-grid">
            {release.report.cases.map((c) => (
              <div key={c.id}>
                <strong>
                  {c.passed ? '✓' : '×'} {c.title}
                </strong>
                <ul>
                  {c.tests.map((t) => (
                    <li key={t.name}>
                      {t.passed ? '✓' : '×'} {t.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="evolution-muted">
            检查在独立环境中执行，覆盖固定样例的规则，不包含新游戏生成对比、画面与真机体验。
          </p>
        </details>
      )}
      {release.error && (
        <p role="alert" className="error-box">
          {release.error}
        </p>
      )}
      {release.status === 'queued' && (
        <p className="evolution-muted">
          当前制作任务结束后，平台会自动执行这次复验。
        </p>
      )}
      {canReview && !active && release.status === 'passed' && (
        <div className="evolution-actions">
          <button
            className="button primary"
            disabled={
              busy ||
              (!release.publishedAt && release.baseReleaseId !== activeId)
            }
            onClick={() => void activate(release.id)}
          >
            {release.publishedAt ? '回退到此版本' : '发布为公共版本'}
          </button>
          {!release.publishedAt && release.baseReleaseId !== activeId && (
            <span className="evolution-muted">
              公共版本已变化，请重新创建候选。
            </span>
          )}
        </div>
      )}
    </article>
  );
}

export function EvolutionDashboard() {
  const [data, setData] = useState<EvolutionOverview>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const requestKey = useRef<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const next = await api<EvolutionOverview>('');
      if (id === sequence.current) setData(next);
      return next;
    } catch (e) {
      if (id === sequence.current) setError((e as Error).message);
      throw e;
    }
  }, []);
  useEffect(() => {
    const requests = sequence;
    void load().catch(() => {});
    return () => {
      requests.current++;
    };
  }, [load]);
  const pending = data?.releases.some(
    (r) => r.status === 'queued' || r.status === 'running',
  );
  useEffect(() => {
    if (!pending) return;
    return startVisiblePolling(
      async () => {
        const next = await load();
        return (
          !next ||
          next.releases.some(
            (r) => r.status === 'queued' || r.status === 'running',
          )
        );
      },
      3000,
      (e) => setError((e as Error).message),
    );
  }, [pending, load]);
  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = data?.releases.find((r) => r.id === data.activeReleaseId);
  const activeCandidates = new Set(active?.entries.map((e) => e.candidateId));
  const ready =
    data?.candidates.filter(
      (c) => c.status === 'reviewed' && !activeCandidates.has(c.id),
    ) || [];
  return (
    <div className="studio-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brandmark">
            <Gamepad2 size={21} />
          </span>
          OpenGame
        </Link>
        <nav className="topnav" aria-label="主导航">
          <Link href="/">创作</Link>
          <Link href="/library">我的作品</Link>
          <Link href="/marketplace">作品广场</Link>
          <Link href="/knowledge">知识库</Link>
        </nav>
        <AccountMenu />
      </header>
      <main className="knowledge-page evolution-page">
        <div className="knowledge-heading">
          <span className="eyebrow">
            <GitBranch size={16} /> 每次创作，都能留下经验
          </span>
          <h1>让下一款游戏做得更好</h1>
          <p>把项目经验整理、审核并复验，发布给所有创作者使用。</p>
        </div>
        <section className="evolution-current" aria-label="当前公共能力版本">
          <div>
            <span>当前公共知识</span>
            <h2>
              {active ? `v${active.number} · ${active.label}` : '基础知识'}
            </h2>
            <p>
              {active
                ? `${active.entries.length} 条已发布经验会按需求供后续创作参考。`
                : '项目经验继续积累；审核后的经验可以组成首个公共版本。'}
            </p>
          </div>
          <Link className="button" href="/knowledge">
            <BookOpen size={16} /> 查看知识库
          </Link>
        </section>
        <div className="knowledge-flow">
          <div>
            <BookOpen size={19} />
            <strong>贡献经验</strong>
            <span>只分享可复用的做法</span>
          </div>
          <div>
            <ShieldCheck size={19} />
            <strong>审核与复验</strong>
            <span>确认内容，再回放固定样例</span>
          </div>
          <div>
            <CheckCircle2 size={19} />
            <strong>发布与回退</strong>
            <span>每个公共版本都有记录</span>
          </div>
        </div>
        <p className="evolution-scope">
          当前支持公共经验的版本升级。回归通过说明参照样例仍符合规则；是否提高新游戏的生成成功率，需要另做对照评估。
        </p>
        {error && (
          <div className="error-box" role="alert">
            {error}
            <button
              className="button"
              onClick={() => {
                setError('');
                void load();
              }}
            >
              重新读取
            </button>
          </div>
        )}
        {notice && (
          <p className="evolution-notice" role="status">
            {notice}
          </p>
        )}
        {!data ? (
          <p className="knowledge-empty">正在读取能力升级记录…</p>
        ) : (
          <>
            <section className="evolution-section">
              <div className="evolution-section-heading">
                <div>
                  <span className="eyebrow">01 / 固定回归样例</span>
                  <h2>让每次复验有据可查</h2>
                </div>
                <FlaskConical size={24} />
              </div>
              <div className="evolution-benchmarks">
                {data.benchmarks.map((b) => (
                  <div key={b.id}>
                    <strong>{b.title}</strong>
                    <span>{b.testCount} 组规则检查</span>
                  </div>
                ))}
              </div>
              <p className="evolution-muted">
                样例源码与检查器按版本固定。复验不调用模型，不消耗创作次数；画面、真机和生成质量单独验收。
              </p>
            </section>
            <section className="evolution-section">
              <span className="eyebrow">02 / 经验候选</span>
              <h2>
                {data.canReview ? '把有依据的经验留下来' : '贡献自己的通用经验'}
              </h2>
              <details className="evolution-contribute">
                <summary>贡献一条项目经验</summary>
                <ContributionForm
                  sources={data.sources}
                  busy={busy}
                  submit={(sourceId, lesson) =>
                    mutate(
                      () =>
                        api('/candidates', { sourceId, lesson, consent: true }),
                      '经验已提交，等待内容审核。',
                    )
                  }
                />
              </details>
              <div className="knowledge-grid">
                {data.candidates.map((c) => (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    canReview={data.canReview}
                    published={activeCandidates.has(c.id)}
                    busy={busy}
                    review={(candidate, decision, note) =>
                      mutate(
                        () =>
                          api(`/candidates/${candidate.id}/review`, {
                            contentHash: candidate.contentHash,
                            decision,
                            note,
                            generalOnly: true,
                          }),
                        decision === 'reviewed'
                          ? '内容审核已通过，可加入待复验版本。'
                          : '已记录审核结论。',
                      )
                    }
                  />
                ))}
              </div>
              {!data.candidates.length && (
                <p className="knowledge-empty">
                  还没有提交的经验候选。私人项目经验不会自动变成公共经验。
                </p>
              )}
            </section>
            {data.canReview && (
              <section className="evolution-section">
                <span className="eyebrow">03 / 创建待复验版本</span>
                <h2>为公共知识增加经过审核的经验</h2>
                <p className="evolution-muted">
                  保留当前公共经验，加入下方选中的条目。复验完成后再发布。
                </p>
                <form
                  className="evolution-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    requestKey.current ||= crypto.randomUUID();
                    void mutate(async () => {
                      await api('/releases', {
                        requestKey: requestKey.current,
                        candidateIds: selected,
                        label,
                        expectedReleaseId: data.activeReleaseId,
                      });
                      requestKey.current = null;
                      setSelected([]);
                      setLabel('');
                    }, '候选版本已排队，平台将自动执行三款游戏的规则复验。');
                  }}
                >
                  <div className="evolution-choices">
                    {ready.map((c) => (
                      <label className="evolution-check" key={c.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(c.id)}
                          disabled={busy}
                          onChange={(e) => {
                            requestKey.current = null;
                            setSelected(
                              e.target.checked
                                ? [...selected, c.id]
                                : selected.filter((id) => id !== c.id),
                            );
                          }}
                        />
                        {c.lesson.title}
                      </label>
                    ))}
                  </div>
                  {!ready.length && (
                    <p className="evolution-muted">
                      通过内容审核后，可在这里选择新的经验。
                    </p>
                  )}
                  <label>
                    版本说明
                    <input
                      required
                      minLength={2}
                      maxLength={80}
                      placeholder="例如：消除、合成与穿行规则经验"
                      value={label}
                      disabled={busy}
                      onChange={(e) => {
                        requestKey.current = null;
                        setLabel(e.target.value);
                      }}
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={busy || pending || !selected.length}
                  >
                    创建版本并开始复验
                  </button>
                </form>
              </section>
            )}
            <section className="evolution-section">
              <div className="evolution-section-heading">
                <div>
                  <span className="eyebrow">04 / 公共版本</span>
                  <h2>每次发布，都可以追溯</h2>
                </div>
                {data.canReview && active && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () =>
                          api('/activate', {
                            targetReleaseId: null,
                            expectedReleaseId: data.activeReleaseId,
                          }),
                        '已回退到基础知识；已有游戏保持原样。',
                      )
                    }
                  >
                    回退到基础知识
                  </button>
                )}
              </div>
              <p className="evolution-muted">
                切换版本只影响后续制作。已有游戏及其知识快照保持原样。
              </p>
              <div className="evolution-releases">
                {data.releases.map((r) => (
                  <ReleaseCard
                    key={r.id}
                    release={r}
                    activeId={data.activeReleaseId}
                    canReview={data.canReview}
                    busy={busy}
                    activate={(id) =>
                      mutate(
                        () =>
                          api('/activate', {
                            targetReleaseId: id,
                            expectedReleaseId: data.activeReleaseId,
                          }),
                        r.publishedAt
                          ? '已回退到所选公共版本。'
                          : '公共版本已发布，后续创作可以使用。',
                      )
                    }
                  />
                ))}
              </div>
              {!data.releases.length && (
                <p className="knowledge-empty">
                  首个公共版本会在这里留下审核与复验记录。
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
