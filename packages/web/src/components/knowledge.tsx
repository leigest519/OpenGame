'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Gamepad2, Layers3, Search, Sparkles } from 'lucide-react';
import type { KnowledgeEntry } from '@/shared/knowledge';
import { AccountMenu } from './access-gate';

export function KnowledgeLibrary() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const load = useCallback(async (text: string) => {
    const id = ++requestId.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/knowledge?${new URLSearchParams({ query: text })}`,
        { cache: 'no-store' },
      );
      const data = await response.json();
      if (response.status === 401)
        window.dispatchEvent(new Event('opengame-session-expired'));
      if (!response.ok) throw new Error(data.error || '暂时无法读取知识库');
      if (id !== requestId.current) return;
      setEntries(data.entries);
      setSelected(data.selectedIds);
      setAppliedQuery(text.trim());
    } catch (e) {
      if (id === requestId.current)
        setError(e instanceof Error ? e.message : '暂时无法读取知识库');
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const requests = requestId;
    void load('');
    return () => {
      requests.current++;
    };
  }, [load]);
  const seedCount = entries.filter((entry) => entry.origin === 'seed').length;
  const publicCount = entries.filter(
    (entry) => entry.origin === 'public',
  ).length;
  const visible = appliedQuery
    ? entries.filter((entry) => selected.includes(entry.id))
    : entries;

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
          <Link className="active" href="/knowledge">
            知识库
          </Link>
        </nav>
        <AccountMenu />
      </header>
      <main className="knowledge-page">
        <div className="knowledge-heading">
          <span className="eyebrow">
            <BookOpen size={16} /> 一起积累，持续复用
          </span>
          <h1>游戏知识库</h1>
          <p>
            从本地游戏出发，为下一次创作准备经验。制作时按需参考，完成后继续积累。
          </p>
          <Link className="button" href="/evolution">
            查看能力升级与公共版本 →
          </Link>
        </div>
        <div className="knowledge-flow" aria-label="知识积累流程">
          <div>
            <BookOpen size={19} />
            <strong>从已有游戏学习</strong>
            <span>提炼适用条件、做法和易错点</span>
          </div>
          <div>
            <Layers3 size={19} />
            <strong>为新玩法选择经验</strong>
            <span>结合项目记忆，自由组合模块</span>
          </div>
          <div>
            <Sparkles size={19} />
            <strong>让制作结果继续积累</strong>
            <span>保存新经验、来源和检查记录</span>
          </div>
        </div>
        <div className="knowledge-stats">
          <span>
            <strong>{seedCount}</strong> 条基础经验
          </span>
          <span>
            <strong>{entries.length - seedCount - publicCount}</strong>{' '}
            条项目经验
          </span>
          <span>
            <strong>
              {entries.filter((entry) => entry.reusableModule).length}
            </strong>{' '}
            条附带可复用模块
          </span>
        </div>
        <form
          className="knowledge-search"
          onSubmit={(event) => {
            event.preventDefault();
            void load(query);
          }}
        >
          <label htmlFor="knowledge-query">下一款游戏想做什么？</label>
          <div>
            <input
              id="knowledge-query"
              value={query}
              maxLength={8000}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：做一个能撤销的消除游戏，支持手机操作"
            />
            <button className="button primary" disabled={busy}>
              <Search size={16} />
              {busy ? '正在读取…' : '查看参考经验'}
            </button>
          </div>
          <p>这里只预览会选取的经验，不会开始制作。</p>
        </form>
        {error && (
          <div className="error-box" role="alert">
            {error}
            <button onClick={() => void load(query)}>重新读取</button>
          </div>
        )}
        <div className="knowledge-list-heading">
          <h2>{appliedQuery ? '这次可以参考' : '已经积累的经验'}</h2>
          {appliedQuery && (
            <button
              onClick={() => {
                setQuery('');
                void load('');
              }}
            >
              查看全部
            </button>
          )}
        </div>
        <p className="knowledge-scope">
          已发布的公共经验供所有成员参考；项目经验仍标记为待复验。每次制作保存实际选用的知识版本。
        </p>
        <div className="knowledge-grid" aria-busy={busy}>
          {visible.map((entry) => (
            <article className="knowledge-card" key={entry.id}>
              <div className="knowledge-card-meta">
                <span
                  className={
                    entry.origin !== 'experience'
                      ? 'knowledge-seed'
                      : 'knowledge-candidate'
                  }
                >
                  {entry.origin === 'seed'
                    ? '基础经验'
                    : entry.origin === 'public'
                      ? `公共经验 · v${entry.publicReleaseNumber}`
                      : '项目经验 · 待复验'}
                </span>
                {entry.reusableModule && <span>附带可复用模块</span>}
              </div>
              <h3>{entry.title}</h3>
              <p className="knowledge-applies">适用于：{entry.appliesTo}</p>
              <p>{entry.advice}</p>
              <p className="knowledge-pitfalls">注意：{entry.pitfalls}</p>
              <div className="knowledge-tags">
                {entry.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <details>
                <summary>来源与验证 · {entry.source.label}</summary>
                <p>{entry.verification}</p>
                {entry.source.projectId && (
                  <Link href={`/projects/${entry.source.projectId}`}>
                    查看来源游戏 →
                  </Link>
                )}
              </details>
            </article>
          ))}
        </div>
        {!busy && !visible.length && !error && (
          <p className="knowledge-empty">
            还没有对应经验，平台仍可根据新玩法原创实现。
          </p>
        )}
        {!busy && entries.length === seedCount && !appliedQuery && (
          <p className="knowledge-empty">
            后续制作通过检查并保存版本后，新归纳的项目经验会出现在这里。
          </p>
        )}
      </main>
    </div>
  );
}
