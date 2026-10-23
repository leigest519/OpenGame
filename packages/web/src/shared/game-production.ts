import { z } from 'zod';
import type { PlaytestPlan } from './game-quality';

const description = (max: number) => z.string().trim().min(1).max(max);
export const criterionIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export const productionPlanSchema = z
  .object({
    coreLoop: description(500),
    firstPlayable: description(500),
    completion: description(500),
    visualDirection: description(400),
    feedback: description(400),
    assumptions: z.array(description(250)).max(5),
    criteria: z
      .array(
        z
          .object({
            id: criterionIdSchema,
            stage: z.enum(['slice', 'delivery']),
            kind: z.enum(['behavior', 'presentation']),
            expectation: description(350),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (new Set(plan.criteria.map((c) => c.id)).size !== plan.criteria.length)
      ctx.addIssue({ code: 'custom', message: '验收点编号不能重复。' });
    if (
      !plan.criteria.some((c) => c.stage === 'slice' && c.kind === 'behavior')
    )
      ctx.addIssue({
        code: 'custom',
        message: '首个可玩片段至少需要一个行为验收点。',
      });
  });
export type ProductionPlan = z.infer<typeof productionPlanSchema>;
export type ProductionStage = 'slice' | 'delivery';

export interface AcceptanceCase {
  criterionId: string;
  variant?: string;
  scenario?: string;
  plan: PlaytestPlan;
}
export interface AcceptanceResult {
  criterionId: string;
  variant?: string;
  scenario?: string;
  status: 'passed' | 'failed';
  steps: number;
  error?: string;
  screenshot: string;
}

export const productionReviewSchema = z
  .object({
    criteria: z
      .array(
        z
          .object({
            criterionId: criterionIdSchema,
            status: z.enum(['met', 'pending-test', 'unmet', 'unverified']),
            evidence: description(700),
            fix: z.string().trim().max(700),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    tests: z
      .array(
        z
          .object({
            criterionId: criterionIdSchema,
            variant: criterionIdSchema.optional(),
            scenario: criterionIdSchema.optional(),
            plan: z.unknown(),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type ProductionReview = Omit<
  z.infer<typeof productionReviewSchema>,
  'tests'
> & { tests: AcceptanceCase[] };

export interface ProductionReport {
  version: 1;
  plan: ProductionPlan;
  planHash: string;
  buildHash: string;
  generations: number;
  reviews: number;
  checks: number;
  criteria: Array<{
    id: string;
    status: 'passed';
    method: 'browser-and-review' | 'presentation-review';
    evidence: string;
  }>;
  checkpoints: Array<{
    stage: ProductionStage;
    check: number;
    buildHash: string;
    acceptance: AcceptanceResult[];
  }>;
}

// Shared by conversation planning and the fallback used for legacy/direct builds.
export const productionPlanInstructions = `游戏计划另外包含 production：
{"coreLoop":"玩家主要动作、选择、反馈和进展；观赏场景写探索与镜头操作", "firstPlayable":"一段能验证主要体验的完整小样", "completion":"本轮完整交付范围及小样之后需要补齐的内容", "visualDirection":"适合这款作品的形状、层次与信息表达", "feedback":"主要动作的视觉、动效和声音反馈；尊重无声要求", "assumptions":["设计默认选择，不冒充用户要求"], "criteria":[{"id":"小写英文及连字符的稳定编号", "stage":"slice或delivery", "kind":"behavior或presentation", "expectation":"具体可观察的预期结果"}]}。
criteria 共2–6条且编号唯一，至少一条 slice 的 behavior。slice 项在完整版本中仍须满足。新建较完整的作品把内容扩充、结束流程等设为 delivery；简单小作品可全部为 slice，避免机械分阶段。旧游戏局部修改只列本轮变化与相关回归，不要求重新制作原型。不要把同一条里塞入大量无关检查。
behavior 必须能用真实点击/按键及可见文本在短场景内检验；包括主要行为及适用的恢复/失败边界，不只检查 canvas 存在。presentation 用实际画面判断辨识、层级与主题，声音只可检查接线和控件，不能要求自动证明听感或有趣。验收目标先于实现，不以程序当前行为反推预期。核心玩法不应为测试而改规则。难以自动证明的体验假设写入 assumptions 并标明待玩家试玩。
长流程的胜负/经济边界可以用命名的受控初始场景覆盖，不要求在五秒里自然通关，也不能为此加速正常游戏。场景只改变初始局面，随后走正常输入、推进与结算。计划应区分场景验证和完整游玩，胜利与失败等不同分支各用一个场景，最多八个独立场景。
coreLoop/firstPlayable/completion 各≤500字，visualDirection/feedback 各≤400字，assumptions≤5条且每条≤250字，expectation≤350字。`;
