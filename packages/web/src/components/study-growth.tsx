'use client';
import { useState } from 'react';
import {
  canExpand,
  foxStage,
  foxStages,
  shopExpansions,
  type ShopAdventure,
} from '../shared/study-adventure';
import s from './study-adventure.module.css';
export type FoxMotion = 'idle' | 'wave' | 'read' | 'celebrate' | 'dance';
export function FoxSprite({
  stage,
  motion = 'idle',
}: {
  stage: number;
  motion?: FoxMotion;
}) {
  const column =
    motion === 'wave'
      ? 1
      : motion === 'read'
        ? 2
        : motion === 'celebrate' || motion === 'dance'
          ? 3
          : 0;
  return (
    <span
      className={s.foxSprite}
      role="img"
      aria-label={`${foxStages[stage].name}，${{ idle: '微笑站立', wave: '举手打招呼', read: '坐下读书', celebrate: '举手欢呼', dance: '开心转圈' }[motion]}`}
      style={{
        backgroundImage: 'url(/study/fox-growth-v3.png)',
        backgroundPosition: `${(column * 100) / 3}% ${stage * 50}%`,
      }}
    />
  );
}
export function StudyGrowth({
  adventure: a,
  busy,
  onExpand,
}: {
  adventure: ShopAdventure;
  busy: boolean;
  onExpand: (stage: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const stage = foxStage(a.growthXp);
  const next = foxStages[stage + 1];
  const current = foxStages[stage];
  const nextShop = shopExpansions[a.expansion + 1];
  const fraction = next
    ? Math.min(100, ((a.growthXp - current.xp) / (next.xp - current.xp)) * 100)
    : 100;
  return (
    <section className={s.growth} aria-label="伙伴成长与商店扩建">
      <div className={s.growthHeading}>
        <div>
          <span className={s.eyebrow}>GROWING TOGETHER · 一起长大</span>
          <h2>
            Lv.{stage + 1} {current.name}
          </h2>
        </div>
        <b>✦ {a.growthXp} 成长星</b>
      </div>
      <div
        className={s.growthTrack}
        role="progressbar"
        aria-label="下一阶段成长进度"
        aria-valuemin={current.xp}
        aria-valuemax={next?.xp ?? Math.max(current.xp, a.growthXp)}
        aria-valuenow={a.growthXp}
      >
        <span style={{ width: `${fraction}%` }} />
      </div>
      <p>
        {next ? (
          <>
            再获得 <strong>{next.xp - a.growthXp} 颗成长星</strong>
            ，伙伴就会穿上{next.look}。
          </>
        ) : (
          <>已经成为星光守护者！继续陪朋友读书，把不熟的知识学会。</>
        )}
      </p>
      <div className={s.growthButtons}>
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? '收起成长图鉴 ↑' : '看看未来的样子 →'}
        </button>
        {nextShop && canExpand(a, a.expansion + 1) && (
          <button
            className={s.primary}
            disabled={busy}
            onClick={() => onExpand(a.expansion + 1)}
          >
            🔨 扩建{nextShop.name}
          </button>
        )}
      </div>
      {nextShop && (
        <small>
          下一次扩建：{nextShop.name} ·{' '}
          {a.growthXp >= nextShop.xp
            ? '成长星已达成'
            : `还差 ${nextShop.xp - a.growthXp} 颗成长星`}{' '}
          ·{' '}
          {a.chapter >= nextShop.chapter
            ? '故事已完成'
            : `完成第 ${nextShop.chapter} 章`}{' '}
          · 免费扩建
        </small>
      )}
      {open && (
        <div className={s.journey}>
          <p className={s.growthRules}>
            独立答对新题或到期复习 +1；首次完成章节 +4；每天首次完成营业委托
            +2。成长星不会花掉，互动不刷星，离开也不会倒退。
          </p>
          <div className={s.evolutionCards}>
            {foxStages.map((f, i) => (
              <article
                key={f.name}
                className={i === stage ? s.stageCurrent : ''}
              >
                <div className={s.portrait}>
                  <FoxSprite stage={i} />
                </div>
                <small>{i <= stage ? '已成长到这里' : '未来的模样'}</small>
                <h3>
                  Lv.{i + 1} {f.name}
                </h3>
                <p>{f.look}</p>
                <span>
                  {f.xp} 成长星 · {f.skill}
                </span>
              </article>
            ))}
          </div>
          <h3>亲手为商店添一个新地方</h3>
          <div className={s.expansionCards}>
            {shopExpansions.map((building, i) => (
              <article key={building.name}>
                <img
                  src={building.image}
                  alt={`${building.name}扩建效果预览`}
                  loading="lazy"
                />
                <div>
                  <small>
                    {i <= a.expansion
                      ? '已建成'
                      : i === a.expansion + 1
                        ? '下一次扩建'
                        : '未来蓝图'}
                  </small>
                  <h3>{building.name}</h3>
                  <p>{building.description}</p>
                  {i > a.expansion && (
                    <>
                      <p>
                        {building.xp} 成长星 + 第 {building.chapter} 章
                      </p>
                      <button
                        disabled={busy || !canExpand(a, i)}
                        onClick={() => onExpand(i)}
                      >
                        {canExpand(a, i)
                          ? '动手扩建 →'
                          : i > a.expansion + 1
                            ? '先完成上一阶段扩建'
                            : '继续学习，点亮蓝图'}
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
