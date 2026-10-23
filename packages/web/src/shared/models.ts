export const generationModels = ['default', 'gpt-6-astra'] as const;
export type GenerationModel = (typeof generationModels)[number];
export const modelLabels: Record<GenerationModel, string> = {
  default: '平台默认',
  'gpt-6-astra': 'GPT-6 Astra',
};
export function isGenerationModel(value: unknown): value is GenerationModel {
  return generationModels.includes(value as GenerationModel);
}
