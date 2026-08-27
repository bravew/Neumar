import type { VideoTemplateId } from '@/shared/types/video';

export const DEFAULT_VIDEO_PROJECT_TEMPLATE: VideoTemplateId = 'custom';

export const VIDEO_PROJECT_TEMPLATES: VideoTemplateId[] = [
  'product-reel',
  'explainer',
  'slideshow',
  'podcast',
  'ugc-ad',
  'custom',
];
