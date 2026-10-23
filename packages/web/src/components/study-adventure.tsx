'use client';
import { useEffect, useRef, useState } from 'react';
import {
  adventureState,
  shopChapters,
  shopItems,
  foxStage,
  foxStages,
  shopExpansions,
  type ShopAdventure,
  type ShopChallenge,
} from '../shared/study-adventure';
import type { StudyState } from '../shared/study';
import s from './study-adventure.module.css';
import { FoxSprite, StudyGrowth, type FoxMotion } from './study-growth';

type Feedback = {
  growth?: number;
  correct: boolean;
  answer: number;
  explanation: string;
  reward: number;
  bonus: number;
  completed: boolean;
  helped: boolean;
};
type Result = {
  adventure: ShopAdventure;
  progress: StudyState;
  town: { wood: number; buildings: number[] };
  feedback?: Feedback;
};
const objects: Record<string, string> = {
  price: '🏷️',
  money: '🪙',
  receipt: '🧾',
  basket: '🧺',
  entrance: '🚪',
  exit: '🚶',
  customer: '🐰',
  newspaper: '📰',
  fridge: '🧊',
  pillow: '🛏️',
  ladder: '🪜',
  carpet: '🟫',
  moon: '🌙',
  sun: '☀️',
  space: '🚀',
  band: '🎸',
  stage: '🎭',
  sink: '🚰',
};
function objectIcon(text: string) {
  return objects[text.toLowerCase().trim()] || '📦';
}
export function StudyAdventure({
  courseId,
  value,
  onChange,
}: {
  courseId: string;
  value?: Partial<ShopAdventure>;
  onChange: (result: Result) => void;
}) {
  const a = adventureState(value);
  const [name, setName] = useState(a.name || '栗栗');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState<number | null>(null);
  const [last, setLast] = useState<{
    question: ShopChallenge;
    feedback: Feedback;
    step: number;
    total: number;
    chapter: number;
  } | null>(null);
  const [panel, setPanel] = useState<'story' | 'decorate' | 'memories'>(
    'story',
  );
  const [item, setItem] = useState('flowers');
  const [pet, setPet] = useState(0);
  const [motion, setMotion] = useState<{ kind: FoxMotion; serial: number }>({
    kind: 'idle',
    serial: 0,
  });
  const [milestone, setMilestone] = useState('');
  const stage = foxStage(a.growthXp);
  const building = shopExpansions[a.expansion];
  function animate(kind: FoxMotion) {
    setMotion((m) => ({ kind, serial: m.serial + 1 }));
  }
  useEffect(() => {
    if (motion.kind === 'idle') return;
    const timer = setTimeout(
      () => setMotion((m) => ({ ...m, kind: 'idle' })),
      3400,
    );
    return () => clearTimeout(timer);
  }, [motion.kind, motion.serial]);
  const lock = useRef(false);
  const pending = useRef<{
    kind: 'answer';
    missionId: string;
    step: number;
    choice: number;
    requestKey: string;
  } | null>(null);
  const chapter = Math.min(last?.chapter ?? a.active?.chapter ?? a.chapter, 3);
  const story = shopChapters[chapter];
  const q = last?.question || a.active?.questions[a.active.step];
  const level = foxStages[stage].name;
  const talk =
    motion.kind === 'read'
      ? '坐下来一起读一会儿吧，难题也可以慢慢想。'
      : motion.kind === 'dance'
        ? '你看，我学会了新的庆祝动作！'
        : last
          ? last.feedback.correct
            ? last.feedback.completed
              ? '我们做到了！这家店又有了新的故事。'
              : '就是它！我把这一份收好啦。'
            : '没关系，我陪你找线索。看懂以后再亲手试一次。'
          : pet
            ? [
                '有你在，开店就没有那么难啦！',
                '我最喜欢你给小店选的装饰。',
                '慢慢来，今天也能学会一点新东西。',
              ][pet % 3]
            : !a.name
              ? '你好呀！我想开一家商店，你愿意做我的搭档吗？'
              : a.active
                ? '一起把这份委托完成吧！'
                : a.chapter === 0
                  ? '第一位客人快来啦，我们先去采购。'
                  : a.chapter === 1
                    ? '货物齐了！给店门口挑一件你喜欢的装饰吧。'
                    : a.chapter === 2
                      ? '店里焕然一新。你听，门铃响了！'
                      : '老朋友又寄来委托啦。还有故事在等我们发现。';
  async function send(action: unknown): Promise<Result | undefined> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/study/${courseId}/adventure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      const result = await response.json();
      if (response.status === 401)
        window.dispatchEvent(new Event('opengame-session-expired'));
      if (!response.ok)
        throw new Error(result.error || '操作没有保存，请重试。');
      if (foxStage(result.adventure.growthXp) > stage) {
        setMilestone(
          `长大啦！${a.name || '伙伴'}成为了${foxStages[foxStage(result.adventure.growthXp)].name}，新装扮和动作已解锁。`,
        );
        animate('celebrate');
      }
      if (result.adventure.expansion > a.expansion) {
        setMilestone(
          `扩建完成！${shopExpansions[result.adventure.expansion].name}正式加入我们的小店。`,
        );
        animate('celebrate');
      }
      onChange(result);
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit() {
    if (!a.active || !q || choice === null) return;
    pending.current ??= {
      kind: 'answer',
      missionId: a.active.id,
      step: a.active.step,
      choice,
      requestKey: crypto.randomUUID(),
    };
    const result = await send(pending.current);
    if (result?.feedback) {
      animate(result.feedback.correct ? 'celebrate' : 'read');
      pending.current = null;
      setLast({
        question: q,
        feedback: result.feedback,
        step: a.active.step,
        total: a.active.questions.length,
        chapter: a.active.chapter,
      });
    }
  }
  function next() {
    const completed = last?.feedback.completed;
    setLast(null);
    setChoice(null);
    if (completed && a.chapter === 1) setPanel('decorate');
    else if (completed && a.chapter === 3) setPanel('memories');
  }
  function speak() {
    if (!q || !('speechSynthesis' in window)) {
      setError('此设备暂不支持朗读。');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      q.prompt.replace(/_+/g, 'blank'),
    );
    utterance.lang = 'en-US';
    utterance.rate = 0.8;
    window.speechSynthesis.speak(utterance);
  }
  async function start() {
    const result = await send({ kind: 'start' });
    if (result) {
      setLast(null);
      setChoice(null);
      setPanel('story');
    }
  }
  return (
    <div className={s.adventure}>
      <div className={s.top}>
        <div>
          <span className={s.eyebrow}>WOODLAND STORIES · 森林开店记</span>
          <h1>
            {a.name
              ? `${a.name}和你的森林小店`
              : '一只小狐狸，一家属于你们的店'}
          </h1>
        </div>
        <div className={s.coins}>
          🍃 {a.coins} <small>星叶</small>
        </div>
      </div>
      <div
        className={`${s.scene} ${a.chapter >= 3 ? s.open : ''}`}
        aria-label="可以装饰和互动的森林商店"
      >
        <img
          className={s.backdrop}
          key={building.image}
          src={building.image}
          alt={`${building.name}：${building.description}`}
        />
        <div className={s.buildingLabel}>
          {building.name} · Lv.{a.expansion + 1}
        </div>
        <div className={s.shopSign}>
          {a.chapter >= 3
            ? 'OPEN · 营业中'
            : a.chapter >= 1
              ? '即将开业'
              : '小店筹备中'}
        </div>
        <div className={s.bubble} role="status">
          {talk}
        </div>
        <button
          className={`${s.fox} ${s[motion.kind]}`}
          key={`fox${motion.serial}`}
          onClick={() => {
            setPet((n) => n + 1);
            animate('wave');
          }}
          aria-label={`摸摸${a.name || '小狐狸'}`}
        >
          <FoxSprite stage={stage} motion={motion.kind} />
          <span className={`${s.scarf} ${s[a.scarf]}`}>♥</span>
          {motion.kind === 'celebrate' && <i>✦</i>}
        </button>
        {a.name && (
          <div className={s.nameTag}>
            {a.name} · {level}
          </div>
        )}
        {(['left', 'right', 'door'] as const).map((slot) => {
          const decoration = shopItems.find((i) => i.id === a.slots[slot]);
          return (
            <button
              key={slot}
              className={`${s.slot} ${s[slot]} ${panel === 'decorate' ? s.placing : ''}`}
              disabled={busy || !a.name || panel !== 'decorate'}
              aria-label={`${slot === 'left' ? '左侧' : slot === 'right' ? '右侧' : '门前'}摆放${shopItems.find((i) => i.id === item)?.name || '装饰'}`}
              onClick={() => void send({ kind: 'decorate', item, slot })}
            >
              {decoration ? (
                <span title={decoration.name}>{decoration.icon}</span>
              ) : panel === 'decorate' ? (
                <b>＋ 放这里</b>
              ) : null}
            </button>
          );
        })}
        {a.active && chapter >= 2 && (
          <div className={s.customer} key={a.active.step}>
            <span>{a.active.step % 2 === 0 ? '🐰' : '🐻'}</span>
            <small>
              {a.active.step % 2 === 0 ? '兔子邮递员' : '熊先生'}
              <br />
              等你帮忙
            </small>
          </div>
        )}
        {a.active && chapter === 0 && (
          <div className={s.cart}>
            🛒{' '}
            <span>
              {a.active.step}/{a.active.questions.length} 已采购
            </span>
          </div>
        )}
        {a.chapter >= 3 && !a.active && (
          <div className={s.visitor}>
            🐰 <span>“我还会再来的！”</span>
          </div>
        )}
      </div>
      <div className={s.petActions} aria-label="和伙伴互动">
        <button
          onClick={() => {
            setPet((n) => n + 1);
            animate('wave');
          }}
        >
          👋 打个招呼
        </button>
        <button onClick={() => animate('read')}>📖 一起读书</button>
        <button disabled={stage < 1} onClick={() => animate('dance')}>
          {stage < 1 ? '🔒 Lv.2 解锁转圈' : '🎵 开心转圈'}
        </button>
        <button disabled={stage < 2} onClick={() => animate('celebrate')}>
          {stage < 2 ? '🔒 Lv.3 解锁星光庆祝' : '✨ 星光庆祝'}
        </button>
      </div>
      {milestone && (
        <div className={s.milestone} role="status">
          <span>✨ {milestone}</span>
          <button onClick={() => setMilestone('')}>收下这份回忆 ✓</button>
        </div>
      )}
      {a.name && (
        <StudyGrowth
          adventure={a}
          busy={busy}
          onExpand={(stage) => void send({ kind: 'expand', stage })}
        />
      )}
      {!a.name ? (
        <form
          className={s.welcome}
          onSubmit={(e) => {
            e.preventDefault();
            void send({ kind: 'adopt', name });
          }}
        >
          <div>
            <h2>先认识一下吧</h2>
            <p>给伙伴起个名字，一起采购、装饰、接待第一位客人。</p>
          </div>
          <label>
            伙伴的名字
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={12}
              required
            />
          </label>
          <button className={s.primary} disabled={busy || !name.trim()}>
            成为开店搭档 →
          </button>
        </form>
      ) : (
        <>
          <div className={s.nav}>
            <button
              aria-pressed={panel === 'story'}
              onClick={() => setPanel('story')}
            >
              📖 开店故事
            </button>
            <button
              aria-pressed={panel === 'decorate'}
              onClick={() => setPanel('decorate')}
            >
              🎨 装饰与换装
            </button>
            <button
              aria-pressed={panel === 'memories'}
              onClick={() => setPanel('memories')}
            >
              💌 我们的回忆
            </button>
          </div>
          {panel === 'story' && (
            <>
              <div className={s.chapters}>
                {shopChapters.slice(0, 3).map((c, i) => (
                  <div
                    key={c.title}
                    className={a.chapter === i ? s.current : ''}
                  >
                    <span>{a.chapter > i ? '✓' : `0${i + 1}`}</span>
                    <b>{c.title}</b>
                    <small>
                      {a.chapter > i
                        ? '故事已完成'
                        : a.chapter === i
                          ? '正在发生'
                          : '接下来的故事'}
                    </small>
                  </div>
                ))}
              </div>
              {q ? (
                <section className={s.task}>
                  <div className={s.taskHeading}>
                    <span>
                      {story.icon} {story.task} ·{' '}
                      {(last?.step ?? a.active?.step ?? 0) + 1}/
                      {last?.total || a.active?.questions.length || 3}
                    </span>
                    <button onClick={speak} aria-label="朗读英语任务">
                      🔊 听一听
                    </button>
                  </div>
                  {!q.adapted && (
                    <small className={s.letter}>
                      一位居民带来了学习来信，读完整封信再帮他解答。
                    </small>
                  )}
                  <p className={s.prompt}>{q.prompt}</p>
                  <p className={s.instructions}>
                    {chapter === 1
                      ? '选一张词语卡，放到招牌工作台。'
                      : '点击挑选，或拖到下面的交付区。'}
                    {last ? '' : '确认后再交给小狐狸。'}
                  </p>
                  <div
                    className={`${s.shelf} ${chapter === 1 ? s.wordTiles : ''}`}
                  >
                    {q.options.map((option, index) => (
                      <button
                        key={`${q.id}-${index}`}
                        draggable={!busy && !last && !pending.current}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', String(index));
                          setChoice(index);
                        }}
                        onClick={() => setChoice(index)}
                        disabled={busy || !!last || !!pending.current}
                        aria-pressed={choice === index}
                        className={
                          last && index === last.feedback.answer
                            ? s.correct
                            : ''
                        }
                      >
                        {chapter !== 1 && (
                          <span className={s.object}>{objectIcon(option)}</span>
                        )}
                        <strong>{option}</strong>
                        {choice === index && !last && <small>已挑选 ✓</small>}
                      </button>
                    ))}
                  </div>
                  {!last ? (
                    <div
                      className={`${s.delivery} ${choice !== null ? s.loaded : ''}`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (busy || pending.current) return;
                        const index = Number(
                          e.dataTransfer.getData('text/plain'),
                        );
                        if (
                          Number.isInteger(index) &&
                          index >= 0 &&
                          index < q.options.length
                        )
                          setChoice(index);
                      }}
                    >
                      <div>
                        <span>
                          {chapter === 1 ? '🪧' : chapter >= 2 ? '🛎️' : '🧺'}
                        </span>
                        <p>
                          {choice === null
                            ? '把你挑选的卡片放在这里'
                            : q.options[choice]}
                        </p>
                      </div>
                      <button
                        className={s.primary}
                        disabled={busy || choice === null}
                        onClick={() => void submit()}
                      >
                        {busy
                          ? '正在交付…'
                          : pending.current
                            ? '重试提交'
                            : story.action + ' →'}
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`${s.feedback} ${last.feedback.correct ? s.success : ''}`}
                      role="status"
                    >
                      <h3>
                        {last.feedback.completed
                          ? `🎉 委托完成！+${last.feedback.bonus} 星叶`
                          : last.feedback.correct
                            ? '✨ 这次交付成功！'
                            : '💡 一起找找线索'}
                      </h3>
                      <p>{last.feedback.explanation}</p>
                      {!!last.feedback.growth && (
                        <p className={s.growthReward}>
                          ✦ +{last.feedback.growth} 成长星 ·
                          伙伴和小店又成长了一点
                        </p>
                      )}
                      <small>
                        {last.feedback.correct
                          ? last.feedback.helped
                            ? '在提示下完成，稍后还会独立复习这道题。'
                            : last.feedback.reward
                              ? `独立完成新题或到期复习，另获 ${last.feedback.reward} 份小镇建材。`
                              : '这次是巩固练习，不重复计算掌握程度。'
                          : '已经记下这个知识点。看懂线索后再试，不会扣掉建筑或奖励。'}
                      </small>
                      <button className={s.primary} onClick={next}>
                        {last.feedback.completed
                          ? a.chapter === 1
                            ? '用奖励装饰我的店 →'
                            : a.chapter === 3
                              ? '收下常客的明信片 →'
                              : '看看下一段故事 →'
                          : last.feedback.correct
                            ? '继续下一份委托 →'
                            : '我懂了，再试一次 →'}
                      </button>
                    </div>
                  )}
                  <details className={s.source}>
                    <summary>这份任务来自哪里？</summary>
                    {q.source} ·
                    答案与解析由原学习材料整理；商店改写题保留相同知识点。
                  </details>
                </section>
              ) : (
                <section className={s.invitation}>
                  <span className={s.invitationIcon}>{story.icon}</span>
                  <div>
                    <span className={s.eyebrow}>
                      {a.chapter < 3
                        ? `第 ${a.chapter + 1} 章 · 建议每天完成一小段`
                        : '来自老朋友的新委托'}
                    </span>
                    <h2>{story.title}</h2>
                    <p>
                      {story.subtitle}。每轮最多 3
                      个任务，随时可以离开，下次接着来。
                    </p>
                    {a.chapter === 1 && !Object.keys(a.slots).length ? (
                      <button
                        className={s.primary}
                        onClick={() => setPanel('decorate')}
                      >
                        先挑一件装饰 →
                      </button>
                    ) : (
                      <button
                        className={s.primary}
                        disabled={busy}
                        onClick={() => void start()}
                      >
                        {a.chapter < 3 ? '和伙伴出发 →' : '开始今天的营业 →'}
                      </button>
                    )}
                    <small>
                      {a.chapter < 3
                        ? `首次完成本章获得 ${story.reward} 星叶和新装饰。`
                        : '每天首次完成营业委托获得 5 星叶。不会因为缺席损失成果。'}
                    </small>
                  </div>
                </section>
              )}
            </>
          )}
          {panel === 'decorate' && (
            <section className={s.decorPanel}>
              <h2>这家店，由你来布置</h2>
              <p>
                先选装饰，再点画面里的“左侧 / 右侧 /
                门前”。已拥有的装饰可以免费移动，更换后仍留在收藏里。
              </p>
              <div className={s.catalog}>
                {shopItems.map((i) => (
                  <button
                    key={i.id}
                    disabled={busy || a.chapter < i.chapter}
                    onClick={() => setItem(i.id)}
                    aria-pressed={item === i.id}
                  >
                    <span>{i.icon}</span>
                    <b>{i.name}</b>
                    <small>
                      {a.owned.includes(i.id)
                        ? '已拥有 · 免费摆放'
                        : a.chapter < i.chapter
                          ? `完成第 ${i.chapter} 章解锁`
                          : `${i.cost} 星叶`}
                    </small>
                  </button>
                ))}
              </div>
              <p className={s.placeHint}>
                已选：{shopItems.find((i) => i.id === item)?.name}。放到：
              </p>
              <div className={s.placementButtons}>
                {(['left', 'right', 'door'] as const).map((slot) => (
                  <button
                    disabled={busy}
                    key={slot}
                    onClick={() => void send({ kind: 'decorate', item, slot })}
                  >
                    {slot === 'left'
                      ? '左侧花园'
                      : slot === 'right'
                        ? '右侧门廊'
                        : '店门前'}
                  </button>
                ))}
              </div>
              <h3>给伙伴选一条围巾</h3>
              <div className={s.placementButtons}>
                {(['mint', 'rose', 'gold'] as const).map((color, i) => (
                  <button
                    key={color}
                    aria-pressed={a.scarf === color}
                    disabled={busy || a.chapter < [0, 1, 3][i]}
                    onClick={() => void send({ kind: 'scarf', color })}
                  >
                    {['🌿 薄荷绿', '🌸 草莓粉 · 第1章', '🌟 星光金 · 第3章'][i]}
                  </button>
                ))}
              </div>
              <button className={s.primary} onClick={() => setPanel('story')}>
                回到开店故事 →
              </button>
            </section>
          )}
          {panel === 'memories' && (
            <section className={s.memories}>
              <h2>和{a.name}一起留下的回忆</h2>
              <p>
                {level} · 已完成 {a.rounds}{' '}
                轮委托。摸摸画面里的伙伴，它有话想对你说。
              </p>
              <div className={s.postcards}>
                {[
                  '我们一起找齐了第一箱货物。',
                  '店门前有了你亲手挑的装饰。',
                  '“谢谢你！下次我还来。”——兔子邮递员',
                ].map((text, i) => (
                  <article
                    key={text}
                    className={a.chapter > i ? s.unlocked : ''}
                  >
                    <span>{['🧺', '🏡', '💌'][i]}</span>
                    <h3>
                      {a.chapter > i
                        ? shopChapters[i].title
                        : '还没发生的小故事'}
                    </h3>
                    <p>
                      {a.chapter > i
                        ? text
                        : `完成第 ${i + 1} 章后，这张明信片就属于你。`}
                    </p>
                  </article>
                ))}
              </div>
              {!!Object.keys(a.mistakes).length && (
                <>
                  <h3>伙伴的线索本</h3>
                  <p>
                    这里保存商店里遇到的难题；后面的委托会优先安排到期知识点。
                  </p>
                  {Object.values(a.mistakes).map((m) => (
                    <details key={m.sourceId}>
                      <summary>{m.concept}</summary>
                      <p>{m.prompt}</p>
                      <p>{m.explanation}</p>
                      <small>{m.source}</small>
                    </details>
                  ))}
                </>
              )}
            </section>
          )}
        </>
      )}
      {error && (
        <div className={s.error} role="alert">
          {error}
          <button onClick={() => window.location.reload()}>
            刷新并读取已保存进度
          </button>
        </div>
      )}
    </div>
  );
}
