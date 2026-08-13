export const NANO_BANANA_FEATURE_FLAG = 'NEUMA_PROVIDER_NANO_BANANA';
export const NANO_BANANA_MODEL_PATTERN = /nano.?banana/i;

export function isNanoBananaEnabled(): boolean {
  return process.env[NANO_BANANA_FEATURE_FLAG] === '1';
}

export function isNanoBananaModel(modelName: string): boolean {
  return NANO_BANANA_MODEL_PATTERN.test(modelName);
}
