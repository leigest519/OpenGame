import type { GenerationModel } from '../shared/models';
export function generationTimeout(model: GenerationModel = 'default'): number {
  const configured =
    model === 'gpt-6-astra'
      ? process.env.OPENGAME_ASTRA_JOB_TIMEOUT_MS
      : process.env.OPENGAME_JOB_TIMEOUT_MS;
  const value = Number(
    configured || (model === 'gpt-6-astra' ? 1200000 : 600000),
  );
  if (!Number.isSafeInteger(value) || value < 1000 || value > 3600000)
    throw new Error('制作时限配置无效。');
  return value;
}
