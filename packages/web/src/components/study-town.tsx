'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AccountMenu } from './access-gate';
import { studyQueue, type StudyDeck, type StudyState } from '../shared/study';
import styles from './study-town.module.css';
import { StudyAdventure } from './study-adventure';
import type { ShopAdventure } from '../shared/study-adventure';

type Town = { wood: number; buildings: number[] };
type Course = {
  id: string;
  name: string;
  status: string;
  error?: string;
  deck: StudyDeck | null;
  progress: StudyState;
  town: Town;
  adventure?: Partial<ShopAdventure>;
};
type ImportResult = {
  id: string;
  duplicate?: boolean;
  status?: string;
  title?: string;
  cached?: boolean;
};
type DuplicateImport = ImportResult & {
  name: string;
  data: string;
  requestKey: string;
};
type Feedback = {
  correct: boolean;
  answer: number;
  explanation: string;
  progress: StudyState;
  town: Town;
  reward: number;
};
const buildings = [
  '词汇小屋',
  '语法花园',
  '故事书店',
  '星光学校',
  '探索工坊',
  '记忆钟楼',
];
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event('opengame-session-expired'));
  if (!response.ok) throw new Error(value.error || '操作未完成，请重试。');
  return value;
}
export function StudyTown() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAdventure, setShowAdventure] = useState(true);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState<DuplicateImport | null>(null);
  const [notice, setNotice] = useState('');
  const importLock = useRef(false);
  const [tab, setTab] = useState<'play' | 'mistakes' | 'review'>('play');
  const [questionId, setQuestionId] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [session, setSession] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const answerKey = useRef('');
  const pendingImport = useRef(true);
  const course = courses.find((c) => c.id === selected) || courses[0];
  const deck = course?.deck;
  const queue = deck
    ? studyQueue(deck, course.progress, now, tab === 'mistakes')
    : [];
  const question = deck?.questions.find((q) => q.id === questionId);
  const due =
    deck?.questions.filter(
      (q) => !q.needsReview && course.progress[q.id]?.due <= now,
    ).length || 0;
  const mastered = Object.values(course?.progress || {}).filter(
    (p) => p.stage >= 3,
  ).length;
  const mistakes =
    deck?.questions.filter((q) => course.progress[q.id]?.misses > 0) || [];
  const flagged = deck?.questions.filter((q) => q.needsReview) || [];
  useEffect(() => {
    let live = true;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const data = await api<Course[]>('/api/study');
        if (live) {
          setCourses(data);
          setNow(Date.now());
          pendingImport.current = data.some((c) =>
            ['queued', 'running'].includes(c.status),
          );
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        if (pendingImport.current) void refresh();
      }
    }, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  function update(patch: Partial<Course>) {
    setCourses((all) =>
      all.map((c) => (c.id === course?.id ? { ...c, ...patch } : c)),
    );
  }
  function reset() {
    setQuestionId('');
    setFeedback(null);
    setSession([]);
    answerKey.current = '';
  }
  async function upload(file?: File) {
    if (!file || importLock.current) return;
    importLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setDuplicate(null);
    try {
      if (file.size > 6_000_000) throw new Error('每份材料最多 6 MB。');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('文件读取失败。'));
        reader.readAsDataURL(file);
      });
      const result = await api<ImportResult>('/api/study', {
        name: file.name,
        data,
        requestKey: crypto.randomUUID(),
      });
      if (result.duplicate) {
        setDuplicate({
          ...result,
          name: file.name,
          data,
          requestKey: crypto.randomUUID(),
        });
        return;
      }
      await openImport(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      importLock.current = false;
      setBusy(false);
    }
  }
  async function openImport(id: string) {
    pendingImport.current = true;
    setCourses(await api('/api/study'));
    setSelected(id);
    setShowAdventure(true);
    reset();
  }
  async function resolveDuplicate(fresh: boolean) {
    if (!duplicate || importLock.current) return;
    importLock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = fresh
        ? await api<ImportResult>('/api/study', {
            name: duplicate.name,
            data: duplicate.data,
            duplicate: 'new',
            requestKey: duplicate.requestKey,
          })
        : duplicate;
      await openImport(result.id);
      setNotice(
        fresh && !result.duplicate
          ? '已复用题库，新学习进度已创建。原课程不受影响。'
          : '已打开已有材料，学习进度继续保留；没有新增重复课程。',
      );
      setDuplicate(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      importLock.current = false;
      setBusy(false);
    }
  }
  function next() {
    const seen = questionId ? [...session, questionId] : session;
    setSession(seen);
    setFeedback(null);
    answerKey.current = '';
    setQuestionId(queue.find((q) => !seen.includes(q.id))?.id || '');
  }
  async function answer(choice: number) {
    if (!question || !course || busy || feedback) return;
    setBusy(true);
    setError('');
    // Retain the key across a network retry so an answer cannot earn twice.
    if (!answerKey.current) answerKey.current = crypto.randomUUID();
    try {
      const result = await api<Feedback>(`/api/study/${course.id}/answers`, {
        questionId: question.id,
        choice,
        requestKey: answerKey.current,
      });
      setFeedback(result);
      update({ progress: result.progress, town: result.town });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function build(plot: number) {
    if (!course) return;
    setBusy(true);
    setError('');
    try {
      update({ town: await api(`/api/study/${course.id}/build`, { plot }) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/">← Studio</Link>
        <strong>
          学习小镇 <span>LEARNING TOWN</span>
        </strong>
        <AccountMenu />
      </header>
      <main className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.eyebrow}>把知识种进生活</div>
          <h1>
            每天学一点，
            <br />
            小镇长大一点。
          </h1>
          <p>上传学习材料，用词汇、语法与故事建造属于你的小镇。</p>
          <label className={styles.upload}>
            {busy ? '正在处理…' : '＋ 导入学习材料'}
            <input
              type="file"
              disabled={busy}
              accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <small>
            PDF / Word / 图片 / 文本 · 单份 6 MB
            <br />
            PDF 最多 40 页；扫描件请转为图片。
            <br />
            每日最多 5 份，后台生成后即可开始。
          </small>
          <h3>我的学习材料</h3>
          {courses.map((c) => (
            <button
              className={`${styles.course} ${course?.id === c.id ? styles.selected : ''}`}
              key={c.id}
              disabled={busy}
              onClick={() => {
                setSelected(c.id);
                reset();
              }}
            >
              <strong>
                {c.deck?.title || c.name}
                {c.deck && c.name.endsWith('（重新学习）') ? ' · 重新学习' : ''}
              </strong>
              <small>
                {c.status === 'ready'
                  ? `${c.deck?.questions.length} 道任务`
                  : c.status === 'failed'
                    ? '处理未完成'
                    : c.status === 'running'
                      ? '正在整理题库…'
                      : '已排队…'}
              </small>
            </button>
          ))}
          {!courses.length && (
            <p>从第一份学习材料开始。错题和小镇会保存在你的账号下。</p>
          )}
        </aside>
        <section className={styles.main}>
          {error && (
            <div role="alert" className={styles.error}>
              {error}
            </div>
          )}
          {notice && (
            <div className={styles.importNotice} role="status">
              {notice}
            </div>
          )}
          {duplicate && (
            <section className={styles.duplicate} aria-label="发现已上传的材料">
              <h2>这份材料已经上传过了</h2>
              <p>
                已找到「{duplicate.title}」。
                {duplicate.status === 'ready'
                  ? '可以继续原来的进度，或直接用已有题库重新开始，无需再次生成。'
                  : '材料正在处理中，直接回到已有课程等待即可，不会重复排队。'}
              </p>
              <div>
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void resolveDuplicate(false)}
                >
                  {duplicate.status === 'ready'
                    ? '继续已有课程'
                    : '查看处理进度'}
                </button>
                {duplicate.status === 'ready' && (
                  <button
                    disabled={busy}
                    onClick={() => void resolveDuplicate(true)}
                  >
                    用原题库新建学习进度
                  </button>
                )}
                <button disabled={busy} onClick={() => setDuplicate(null)}>
                  取消
                </button>
              </div>
            </section>
          )}
          {deck && (
            <div className={styles.tabs}>
              <button
                aria-pressed={showAdventure}
                onClick={() => setShowAdventure(true)}
              >
                🦊 伙伴商店
              </button>
              <button
                aria-pressed={!showAdventure}
                onClick={() => setShowAdventure(false)}
              >
                📚 练习、错题与小镇
              </button>
            </div>
          )}
          {deck && showAdventure && (
            <StudyAdventure
              key={course.id}
              courseId={course.id}
              value={course.adventure}
              onChange={(result) => update(result)}
            />
          )}
          <div hidden={!!deck && showAdventure}>
            <div className={styles.townHeader}>
              <div>
                <div className={styles.eyebrow}>你的知识家园</div>
                <h2>{deck?.title || '等待第一位镇长'}</h2>
              </div>
              <div className={styles.resource}>
                ▧ {course?.town.wood || 0} 建材
              </div>
            </div>
            <div className={styles.landscape} aria-label="学习小镇建设地图">
              <div className={styles.sun} />
              <div className={styles.cloud} />
              <div className={styles.hills} />
              <div className={styles.plots}>
                {buildings.map((name, index) => {
                  const built = course?.town.buildings.includes(index);
                  return (
                    <button
                      key={name}
                      className={`${styles.plot} ${built ? styles.built : ''}`}
                      disabled={busy || !deck || built}
                      onClick={() => void build(index)}
                      aria-label={
                        built
                          ? `${name}已建成`
                          : `建造${name}，需要${(index + 1) * 3}份建材`
                      }
                    >
                      <div
                        className={styles.house}
                        style={
                          {
                            '--roof': [
                              '#dd805d',
                              '#759d72',
                              '#8b8ac2',
                              '#d5ad50',
                              '#5a9ca3',
                              '#a37bb2',
                            ][index],
                          } as React.CSSProperties
                        }
                      >
                        <div className={styles.roof} />
                        <div className={styles.wall}>
                          <i />
                          <i />
                          <b />
                        </div>
                      </div>
                      <strong>{name}</strong>
                      <span>
                        {built ? '已建成 ✓' : `${(index + 1) * 3} 建材 · 建造`}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className={styles.townNote}>
                新题或到期复习答对 +3 建材 · 重复练习不额外奖励
              </div>
            </div>
            <div className={styles.stats}>
              <span>
                <b>{due}</b> 到期复习
              </span>
              <span>
                <b>{mistakes.length}</b> 错题记录
              </span>
              <span>
                <b>{mastered}</b> 稳定记忆
              </span>
              <span>
                <b>{course?.town.buildings.length || 0}/6</b> 已建建筑
              </span>
            </div>
            {!deck ? (
              <div className={styles.card}>
                <h2>
                  {course?.status === 'failed'
                    ? '这份材料还没有准备好'
                    : course
                      ? '题库正在准备中'
                      : '开启你的第一天'}
                </h2>
                <p>
                  {course?.error ||
                    '上传材料后，系统会提取知识点并整理成学习任务。准备期间可以离开此页，稍后回来继续。'}
                </p>
              </div>
            ) : (
              <>
                <div className={styles.tabs}>
                  {(
                    [
                      ['play', '每日任务'],
                      ['mistakes', `错题本 ${mistakes.length}`],
                      ['review', `待核对 ${flagged.length}`],
                    ] as const
                  ).map(([key, title]) => (
                    <button
                      key={key}
                      disabled={busy}
                      onClick={() => {
                        setTab(key);
                        reset();
                      }}
                      aria-pressed={tab === key}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                <div className={styles.card}>
                  {tab === 'review' ? (
                    <>
                      <h2>先核对，再练习</h2>
                      <p>
                        这些题可能存在识别或答案歧义，暂不计入学习与奖励。请对照原材料与老师确认后，将订正材料重新导入。
                      </p>
                      {flagged.map((q) => (
                        <details key={q.id}>
                          <summary>{q.prompt}</summary>
                          <p>{q.source}</p>
                          <p>{q.explanation}</p>
                        </details>
                      ))}
                      {!flagged.length && (
                        <p>
                          目前没有被标记的题。生成答案仍建议由家长或老师抽查。
                        </p>
                      )}
                    </>
                  ) : question ? (
                    <>
                      <div className={styles.eyebrow}>
                        {question.kind === 'word'
                          ? '词汇采购任务'
                          : question.kind === 'grammar'
                            ? '语法建设任务'
                            : '故事探索任务'}{' '}
                        · {session.length + 1}/{queue.length}
                      </div>
                      <h2>
                        {feedback
                          ? question.concept
                          : question.kind === 'word'
                            ? '为小镇采购物资'
                            : question.kind === 'grammar'
                              ? '完成今天的建设委托'
                              : '发现故事里的线索'}
                      </h2>
                      <p className={styles.question}>{question.prompt}</p>
                      <div className={styles.options}>
                        {question.options.map((option, index) => (
                          <button
                            key={index}
                            disabled={busy || !!feedback}
                            onClick={() => void answer(index)}
                            className={
                              feedback && index === feedback.answer
                                ? styles.correct
                                : ''
                            }
                          >
                            <b>{String.fromCharCode(65 + index)}</b>
                            {option}
                          </button>
                        ))}
                      </div>
                      {feedback && (
                        <div className={styles.feedback} role="status">
                          <h3>
                            {feedback.correct
                              ? feedback.reward
                                ? `答对了！获得 ${feedback.reward} 份建材`
                                : '答对了！这次是巩固练习'
                              : '没关系，我们把这里弄懂'}
                          </h3>
                          <p>{feedback.explanation}</p>
                          <p>
                            {feedback.correct
                              ? '下次复习时间：'
                              : '已加入错题本，下次复习时间：'}
                            {new Date(
                              feedback.progress[question.id].due,
                            ).toLocaleString('zh-CN')}
                          </p>
                          <button
                            className={styles.primary}
                            disabled={busy}
                            onClick={next}
                          >
                            继续任务 →
                          </button>
                        </div>
                      )}
                      <small>出处：{question.source} · 答案由 AI 整理</small>
                    </>
                  ) : (
                    <>
                      <div className={styles.eyebrow}>
                        学习 → 获得建材 → 建设小镇
                      </div>
                      <h2>
                        {session.length
                          ? '这一轮完成了！'
                          : '领取今天的建设任务'}
                      </h2>
                      <p>
                        {tab === 'mistakes'
                          ? '这里保留答错记录，即使后来答对也不会丢失。优先练习到期题，观察自己掌握了多少。'
                          : `优先复习 ${due} 道到期题，再认识新词、理解新语法。1、3、7、14、30、60 天逐步复习，答错后重新巩固。`}
                      </p>
                      <button
                        className={styles.primary}
                        disabled={!queue.length || busy}
                        onClick={() => {
                          setSession([]);
                          setQuestionId(queue[0]?.id || '');
                          setFeedback(null);
                          answerKey.current = '';
                        }}
                      >
                        {session.length ? '再练一轮' : '开始学习任务'}
                      </button>
                      {tab === 'mistakes' &&
                        mistakes.map((q) => (
                          <details key={q.id}>
                            <summary>
                              {q.concept} · 错过 {course.progress[q.id].misses}{' '}
                              次 ·{' '}
                              {course.progress[q.id].stage >= 3
                                ? '逐渐掌握'
                                : '继续巩固'}
                            </summary>
                            <p>{q.prompt}</p>
                            <p>答案：{q.options[q.answer]}</p>
                            <p>{q.explanation}</p>
                            <small>{q.source}</small>
                          </details>
                        ))}
                    </>
                  )}
                </div>
                <details className={styles.source}>
                  <summary>本次材料覆盖范围与答案说明</summary>
                  <p>{deck.summary}</p>
                  <p>
                    材料：{course.name}
                    。稳定记忆表示至少完成三轮间隔答对，不保证以后不会遗忘。
                  </p>
                </details>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
