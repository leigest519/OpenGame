import { z } from 'zod';
import { canvasSelectionSchema } from './canvas';
export const imageBatchSchema = z
  .object({
    canvas: canvasSelectionSchema.optional(),
    requestKey: z.uuid(),
    baseVersionId: z.uuid().nullable(),
    prompt: z.string().trim().min(1).max(4000),
    styles: z.array(z.string().trim().min(1).max(120)).min(2).max(6),
    model: z.enum(['default', 'gpt-6-astra']).default('default'),
  })
  .strict();
export interface ImageBatch {
  grouped?: boolean;
  result_version_id?: string | null;
  id: string;
  project_id: string;
  base_version_id: string | null;
  prompt: string;
  styles: string[];
  status: 'active' | 'completed' | 'cancelled' | 'failed';
  error: string | null;
  created_at: string;
}
export const imageStylePresets = [
  '自然摄影',
  '电影质感',
  '水彩插画',
  '东方水墨',
  '油画',
  '日系动画',
];
