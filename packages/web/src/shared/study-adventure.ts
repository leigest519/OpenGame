import { z } from 'zod';
import { studyQueue, type StudyDeck, type StudyState } from './study';

export const shopItems = [
  { id: 'flowers', name: '雏菊花箱', icon: '🌼', cost: 4, chapter: 1 },
  { id: 'lamp', name: '暖光小灯', icon: '🏮', cost: 6, chapter: 1 },
  { id: 'books', name: '故事书架', icon: '📚', cost: 8, chapter: 2 },
  { id: 'flag', name: '开业彩旗', icon: '🎏', cost: 10, chapter: 2 },
  { id: 'tree', name: '苹果树', icon: '🌳', cost: 16, chapter: 3 },
  { id: 'fountain', name: '小镇喷泉', icon: '⛲', cost: 20, chapter: 3 },
] as const;
export const shopChapters = [
  {
    title: '第一箱货物',
    subtitle: '去森林集市，找齐开店需要的东西',
    task: '采购清单',
    action: '装进采购车',
    icon: '🧺',
    reward: 8,
  },
  {
    title: '我的小店，我做主',
    subtitle: '布置门前，再为商店做好指示牌',
    task: '招牌工作台',
    action: '贴到招牌上',
    icon: '🪧',
    reward: 12,
  },
  {
    title: '第一位常客',
    subtitle: '帮兔子邮递员和小熊完成订单',
    task: '顾客的委托',
    action: '交给顾客',
    icon: '🐰',
    reward: 16,
  },
  {
    title: '小镇营业日',
    subtitle: '回访旧朋友，把还不熟的知识用起来',
    task: '今日委托',
    action: '完成委托',
    icon: '✉️',
    reward: 5,
  },
];
export type ShopChallenge = StudyDeck['questions'][number] & {
  sourceId: string;
  adapted: boolean;
};
export type ShopMission = {
  id: string;
  chapter: number;
  questions: ShopChallenge[];
  step: number;
  assisted: string[];
  day: string;
};
export type ShopAdventure = {
  name: string;
  coins: number;
  chapter: number;
  rounds: number;
  growthXp: number;
  expansion: number;
  owned: string[];
  slots: Record<string, string>;
  scarf: 'mint' | 'rose' | 'gold';
  active: ShopMission | null;
  bonusDays: string[];
  mistakes: Record<string, ShopChallenge>;
};
export function newAdventure(): ShopAdventure {
  return {
    growthXp: 0,
    expansion: 0,
    name: '',
    coins: 0,
    chapter: 0,
    rounds: 0,
    owned: [],
    slots: {},
    scarf: 'mint',
    active: null,
    bonusDays: [],
    mistakes: {},
  };
}
export function adventureState(
  value: Partial<ShopAdventure> | null | undefined,
): ShopAdventure {
  const state = { ...newAdventure(), ...value };
  // Older saves retain chapter and daily-visit achievements, without replaying rewards.
  state.growthXp =
    value?.growthXp ?? state.chapter * 4 + state.bonusDays.length * 2;
  return state;
}
export const adventureAction = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('adopt'),
      name: z.string().trim().min(1).max(12),
    })
    .strict(),
  z.object({ kind: z.literal('start') }).strict(),
  z
    .object({
      kind: z.literal('expand'),
      stage: z.number().int().min(1).max(2),
    })
    .strict(),
  z
    .object({
      kind: z.literal('answer'),
      missionId: z.string().uuid(),
      step: z.number().int().min(0).max(2),
      choice: z.number().int().min(0).max(4),
      requestKey: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('decorate'),
      item: z.enum(['flowers', 'lamp', 'books', 'flag', 'tree', 'fountain']),
      slot: z.enum(['left', 'right', 'door']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('scarf'),
      color: z.enum(['mint', 'rose', 'gold']),
    })
    .strict(),
]);
export function shopDay(now: number) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
// Only rephrase a source question when its verified answer matches a curated scenario.
// Other subjects keep their complete original context as a visitor's letter.
export function shopChallenge(
  q: StudyDeck['questions'][number],
): ShopChallenge {
  const answer = q.options[q.answer]
    .trim()
    .replace(/^[A-E][.)]\s*/, '')
    .toLowerCase();
  const scenes: Record<string, [string, string]> = {
    price: [
      'A customer points to a loaf of bread. “What is the ______ of this bread?”',
      '顾客在问面包的价格。price 表示价格，the price of 表示“……的价格”。',
    ],
    receipt: [
      'After a customer pays, give them a ______ to show what they bought.',
      '付款后提供购物凭证：receipt（收据），不是 money（钱）或 basket（篮子）。',
    ],
    entrance: [
      'Put the “Welcome!” sign at the shop ______, where customers come in.',
      '入口是 entrance，出口是 exit。come in 表示进来，所以这里是在找入口。',
    ],
    basket: [
      'The customer puts apples into a ______ and carries them to the counter.',
      '装苹果并提到柜台的容器是 basket（篮子）。',
    ],
    fridge: [
      'Keep the milk cold. Put it in the ______.',
      '牛奶需要低温保存，fridge 是冰箱。',
    ],
    where: [
      'This is the shop ______ we buy bread every morning.',
      '先行词 shop 表示地点，后面 we buy bread 缺少地点状语，用 where。',
    ],
    who: [
      'The girl ______ works in our shop is very kind.',
      '先行词是人 the girl，后面缺主语，关系代词用 who。',
    ],
    because: [
      'We close the shop early ______ the lights are broken.',
      '灯坏了是提早关店的原因，用 because 引出原因。',
    ],
    so: [
      'The shop is busy, ______ we ask a friend to help.',
      '店里忙是原因，请朋友帮忙是结果，用 so 连接结果。',
    ],
  };
  // Avoid introducing an ambiguous duplicate answer when existing distractors are synonyms.
  const scene = scenes[answer];
  const compatible =
    scene &&
    !q.options.some(
      (o, i) =>
        i !== q.answer &&
        ((answer === 'who' && o.trim().toLowerCase() === 'that') ||
          (answer === 'basket' &&
            ['bag', 'box'].includes(o.trim().toLowerCase()))),
    );
  return {
    ...q,
    sourceId: q.id,
    adapted: !!compatible,
    prompt: compatible ? scene[0] : q.prompt,
    explanation: compatible ? scene[1] : q.explanation,
    source: compatible ? `商店情境改编 · ${q.source}` : q.source,
  };
}
export function missionQuestions(
  deck: StudyDeck,
  state: StudyState,
  now: number,
  chapter: number,
): ShopChallenge[] {
  const candidates = studyQueue(deck, state, now);
  const preferred = chapter === 1 ? 'grammar' : 'word';
  candidates.sort((a, b) => {
    const score = (q: typeof a) =>
      state[q.id]?.due <= now
        ? 0
        : !state[q.id]
          ? q.kind === preferred
            ? 1
            : 2
          : 3;
    return score(a) - score(b);
  });
  return candidates.slice(0, 3).map(shopChallenge);
}

export const foxStages = [
  { name: '围裙小帮手', xp: 0, look: '薄荷围裙', skill: '挥挥手、一起读书' },
  { name: '森林小店长', xp: 12, look: '蓝色马甲与旅行挎包', skill: '开心转圈' },
  { name: '星光守护者', xp: 36, look: '金边披风与叶子徽章', skill: '星光庆祝' },
] as const;
export const shopExpansions = [
  {
    name: '森林小铺',
    xp: 0,
    chapter: 0,
    image: '/study/shop-v2.png',
    description: '我们梦想开始的地方',
  },
  {
    name: '花园阅读屋',
    xp: 12,
    chapter: 2,
    image: '/study/shop-garden-v3.png',
    description: '新建阅读门廊、花园与石板路',
  },
  {
    name: '森林书香广场',
    xp: 36,
    chapter: 3,
    image: '/study/shop-grand-v3.png',
    description: '扩建双翼书屋、咖啡露台与屋顶花园',
  },
] as const;
export function foxStage(xp: number) {
  return xp >= 36 ? 2 : xp >= 12 ? 1 : 0;
}
export function canExpand(a: ShopAdventure, stage: number) {
  const target = shopExpansions[stage];
  return (
    !!target &&
    stage === a.expansion + 1 &&
    a.growthXp >= target.xp &&
    a.chapter >= target.chapter
  );
}
