import type { VideoTemplate } from '../types';
import { PHASE_28_VIDEO_TEMPLATES } from './phase28';

export const BUILTIN_VIDEO_TEMPLATES = [
  {
    id: 'punch-in-ugc-15s-vertical',
    displayName: 'Punch-in UGC · 15s vertical',
    category: 'ad',
    thumbnailUrl: '',
    durationSec: { typical: 15, min: 12, max: 18 },
    aspectRatios: ['9:16'],
    hook: 'punch-in',
    pace: 'fast',
    pricingHint: { low: 0.5, high: 2.5 },
    inputs: [
      {
        key: 'hook',
        kind: 'text',
        label: 'Hook text',
        required: true,
        default: 'Do not miss this',
      },
      {
        key: 'product',
        kind: 'text',
        label: 'Product',
        required: true,
        default: 'the product',
      },
      {
        key: 'cta',
        kind: 'text',
        label: 'Call to action',
        required: true,
        default: 'Get yours today',
      },
      {
        key: 'brandColor',
        kind: 'color',
        label: 'Brand color',
        default: '#ff5722',
      },
    ],
    storyboardSeed: {
      intent: '{{hook}} for {{product}}',
      scenes: [
        {
          durationMs: 2500,
          intent: 'Fast selfie-style opener: {{hook}}.',
          transition: 'cut',
          caption: { text: '{{hook}}' },
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Vertical handheld UGC opener, energetic presenter, product reveal for {{product}}',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 2500,
          },
        },
        {
          durationMs: 5000,
          intent: 'Show the problem and the product solving it: {{product}}.',
          transition: 'cut',
          caption: { text: 'Here is why it works' },
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Close-up problem solution demo, quick cuts, social ad style for {{product}}',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 5000,
          },
        },
        {
          durationMs: 4500,
          intent: 'Proof moment with benefits and visual comparison.',
          transition: 'fade',
          caption: { text: 'Real results, fast' },
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Before and after product benefit montage, natural lighting, {{product}}',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 4500,
          },
        },
        {
          durationMs: 3000,
          intent: 'End card with CTA: {{cta}}.',
          transition: 'cut',
          caption: { text: '{{cta}}' },
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Clean vertical social end card for {{product}}, bold CTA {{cta}}, brand color {{brandColor}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '9:16',
          },
        },
      ],
    },
    styleDefaults: {
      primaryColor: '{{brandColor}}',
      fontFamily: 'Inter',
      captionStyle: { position: 'bottom', animation: 'tiktok-word' },
    },
    providerHints: {
      aiClip: 'seedance-2-0-fast',
      aiImage: 'seedream-5-0-lite',
    },
    version: 1,
    source: 'builtin',
    license: 'CC0',
    projectTemplateId: 'ugc-ad',
  },
  {
    id: 'explainer-30s-horizontal',
    displayName: 'Explainer · 30s horizontal',
    category: 'explainer',
    thumbnailUrl: '',
    durationSec: { typical: 30, min: 24, max: 40 },
    aspectRatios: ['16:9'],
    hook: 'question',
    pace: 'medium',
    pricingHint: { low: 1, high: 4 },
    inputs: [
      { key: 'topic', kind: 'text', label: 'Topic', required: true },
      {
        key: 'audience',
        kind: 'text',
        label: 'Audience',
        default: 'busy professionals',
      },
      { key: 'takeaway', kind: 'text', label: 'Main takeaway', required: true },
    ],
    storyboardSeed: {
      intent: 'Explain {{topic}} for {{audience}}',
      scenes: [
        {
          durationMs: 6000,
          intent: 'Open with the core question about {{topic}}.',
          caption: { text: 'What is {{topic}}?' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-image',
            prompt: 'Clean editorial title card explaining {{topic}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '16:9',
          },
        },
        {
          durationMs: 9000,
          intent: 'Visual analogy that makes {{topic}} concrete.',
          caption: { text: 'A simple way to see it' },
          transition: 'fade',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Polished explainer animation style, simple analogy for {{topic}}, for {{audience}}',
            provider: 'seedance-2-0-fast',
            aspectRatio: '16:9',
            durationMs: 9000,
          },
        },
        {
          durationMs: 9000,
          intent: 'Three practical points for {{audience}}.',
          caption: { text: 'Three practical points' },
          transition: 'slide',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Three-panel clean visual summary of {{topic}} for {{audience}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '16:9',
          },
        },
        {
          durationMs: 6000,
          intent: 'Close with takeaway: {{takeaway}}.',
          caption: { text: '{{takeaway}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'tts-narration',
            text: '{{takeaway}}',
            provider: 'openai-tts',
          },
        },
      ],
    },
    styleDefaults: {
      primaryColor: '#2563eb',
      fontFamily: 'Inter',
      captionStyle: { position: 'bottom', animation: 'classic' },
    },
    providerHints: {
      aiClip: 'seedance-2-0-fast',
      aiImage: 'seedream-5-0-lite',
      tts: 'openai-tts',
    },
    version: 1,
    source: 'builtin',
    license: 'CC0',
    projectTemplateId: 'explainer',
  },
  {
    id: 'product-reel-20s-vertical',
    displayName: 'Product reel · 20s vertical',
    category: 'product',
    thumbnailUrl: '',
    durationSec: { typical: 20, min: 15, max: 30 },
    aspectRatios: ['9:16', '4:5'],
    hook: 'reveal',
    pace: 'fast',
    pricingHint: { low: 0.75, high: 3 },
    inputs: [
      { key: 'product', kind: 'text', label: 'Product', required: true },
      { key: 'benefit', kind: 'text', label: 'Top benefit', required: true },
      { key: 'setting', kind: 'text', label: 'Setting', default: 'studio' },
    ],
    storyboardSeed: {
      intent: '{{product}} product reel',
      scenes: [
        {
          durationMs: 4000,
          intent: 'Hero reveal of {{product}} in a {{setting}} setting.',
          caption: { text: '{{product}}' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Premium vertical product hero reveal for {{product}}, {{setting}}, dramatic light sweep',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 4000,
          },
        },
        {
          durationMs: 6000,
          intent: 'Macro detail shots showing quality and texture.',
          caption: { text: 'Built for detail' },
          transition: 'fade',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Macro detail montage of {{product}}, tactile textures, premium product cinematography',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 6000,
          },
        },
        {
          durationMs: 6000,
          intent: 'Lifestyle usage showing {{benefit}}.',
          caption: { text: '{{benefit}}' },
          transition: 'slide',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Lifestyle product usage, {{product}}, showing benefit {{benefit}}, natural movement',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 6000,
          },
        },
        {
          durationMs: 4000,
          intent: 'Final brand lockup and benefit reminder.',
          caption: { text: '{{benefit}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Premium vertical product end frame for {{product}}, concise benefit text {{benefit}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '9:16',
          },
        },
      ],
    },
    styleDefaults: {
      primaryColor: '#111827',
      fontFamily: 'Inter',
      captionStyle: { position: 'bottom', animation: 'classic' },
    },
    providerHints: {
      aiClip: 'seedance-2-0-fast',
      aiImage: 'seedream-5-0-lite',
    },
    version: 1,
    source: 'builtin',
    license: 'CC0',
    projectTemplateId: 'product-reel',
  },
  {
    id: 'podcast-quote-45s-vertical',
    displayName: 'Podcast quote · 45s vertical',
    category: 'podcast',
    thumbnailUrl: '',
    durationSec: { typical: 45, min: 25, max: 60 },
    aspectRatios: ['9:16'],
    hook: 'cold-open',
    pace: 'medium',
    pricingHint: { low: 0.25, high: 1.25 },
    inputs: [
      { key: 'quote', kind: 'longText', label: 'Quote', required: true },
      { key: 'speaker', kind: 'text', label: 'Speaker', default: 'Guest' },
      { key: 'show', kind: 'text', label: 'Show name', default: 'Podcast' },
    ],
    storyboardSeed: {
      intent: '{{speaker}} quote from {{show}}',
      scenes: [
        {
          durationMs: 5000,
          intent: 'Cold-open title card for {{speaker}} on {{show}}.',
          caption: { text: '{{speaker}}' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Podcast vertical title card, clean waveform motif, {{speaker}}, {{show}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '9:16',
          },
        },
        {
          durationMs: 32000,
          intent: 'Main quote with animated captions: {{quote}}',
          caption: { text: '{{quote}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'tts-narration',
            text: '{{quote}}',
            provider: 'openai-tts',
          },
        },
        {
          durationMs: 8000,
          intent: 'End card for {{show}} with speaker attribution.',
          caption: { text: '{{show}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Podcast vertical end card, {{show}}, speaker attribution {{speaker}}, waveform',
            provider: 'seedream-5-0-lite',
            aspectRatio: '9:16',
          },
        },
      ],
    },
    styleDefaults: {
      primaryColor: '#7c3aed',
      fontFamily: 'Inter',
      captionStyle: { position: 'middle', animation: 'hormozi-bold' },
    },
    providerHints: {
      aiImage: 'seedream-5-0-lite',
      tts: 'openai-tts',
    },
    version: 1,
    source: 'builtin',
    license: 'CC0',
    projectTemplateId: 'podcast',
  },
  {
    id: 'tutorial-screen-recording-60s',
    displayName: 'Tutorial screen recording · 60s',
    category: 'tutorial',
    thumbnailUrl: '',
    durationSec: { typical: 60, min: 30, max: 90 },
    aspectRatios: ['16:9'],
    hook: 'question',
    pace: 'slow',
    pricingHint: { low: 0.15, high: 1 },
    inputs: [
      { key: 'task', kind: 'text', label: 'Task', required: true },
      { key: 'steps', kind: 'longText', label: 'Steps', required: true },
      { key: 'outcome', kind: 'text', label: 'Outcome', required: true },
    ],
    storyboardSeed: {
      intent: 'Tutorial for {{task}}',
      scenes: [
        {
          durationMs: 6000,
          intent: 'Introduce the task: {{task}}.',
          caption: { text: 'How to {{task}}' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-image',
            prompt: 'Clean tutorial title card for {{task}}, software UI style',
            provider: 'seedream-5-0-lite',
            aspectRatio: '16:9',
          },
        },
        {
          durationMs: 42000,
          intent: 'Walk through these steps: {{steps}}.',
          caption: { text: '{{steps}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'broll-search',
            query: 'software tutorial workspace',
            provider: 'pexels',
          },
        },
        {
          durationMs: 12000,
          intent: 'Confirm the finished outcome: {{outcome}}.',
          caption: { text: '{{outcome}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'ai-image',
            prompt: 'Clean completion screen showing outcome {{outcome}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '16:9',
          },
        },
      ],
    },
    styleDefaults: {
      primaryColor: '#0891b2',
      fontFamily: 'Inter',
      captionStyle: { position: 'bottom', animation: 'classic' },
    },
    providerHints: {
      aiImage: 'seedream-5-0-lite',
    },
    version: 1,
    source: 'builtin',
    license: 'CC0',
    projectTemplateId: 'slideshow',
  },
  ...PHASE_28_VIDEO_TEMPLATES,
] satisfies VideoTemplate[];
