import { z } from 'zod';
import { productionPlanSchema } from './game-production';

export const developmentPlanSchema = z
  .object({
    goal: z.string().trim().min(1).max(300),
    decisions: z.array(z.string().trim().min(1).max(300)).max(5),
    tasks: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(80),
            detail: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    checks: z.array(z.string().trim().min(1).max(250)).min(1).max(5),
    // Optional for saved legacy plans and image projects; game builds fill it before editing.
    production: productionPlanSchema.optional(),
  })
  .strict();

export const conversationResultSchema = z
  .object({
    action: z.enum(['discuss', 'propose', 'implement']),
    reply: z.string().trim().min(1).max(2500),
    plan: developmentPlanSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action !== 'discuss' && !value.plan)
      ctx.addIssue({ code: 'custom', message: '开始制作前需要明确本轮任务。' });
    if (value.action === 'discuss' && value.plan)
      ctx.addIssue({ code: 'custom', message: '讨论回复不能被当作实施计划。' });
  });
export type DevelopmentPlan = z.infer<typeof developmentPlanSchema>;
export type ConversationResult = z.infer<typeof conversationResultSchema>;

export function parseConversationResult(text: string): ConversationResult {
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```$/, '');
  try {
    return conversationResultSchema.parse(JSON.parse(json));
  } catch {
    throw new Error('没有整理出完整的回复，本次未开始制作。请重新发送。');
  }
}

export function planInstructions(plan: DevelopmentPlan): string {
  return `本轮目标：${plan.goal}\n已明确的约定：\n${plan.decisions.map((x) => `- ${x}`).join('\n')}\n实施任务：\n${plan.tasks.map((t, i) => `${i + 1}. ${t.title}：${t.detail}`).join('\n')}\n试玩验收要点（未经平台逐项验证）：\n${plan.checks.map((x) => `- ${x}`).join('\n')}${plan.production ? `\n制作体验与验收约定：\n${JSON.stringify(plan.production)}` : ''}`;
}
