import type { PromptTemplateSnapshot } from '@/shared/types/design-mode';

const DEFAULT_ASPECT_BY_SURFACE: Record<'image' | 'video', string> = {
  image: '4 / 3',
  video: '16 / 9',
};

export function aspectRatioStyle(
  template: Pick<PromptTemplateSnapshot, 'aspect' | 'surface'>,
): { aspectRatio: string } {
  const ratio = template.aspect?.replace(':', ' / ');
  return {
    aspectRatio:
      ratio ?? DEFAULT_ASPECT_BY_SURFACE[template.surface] ?? '4 / 3',
  };
}
