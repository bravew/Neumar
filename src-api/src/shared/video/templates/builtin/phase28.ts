import type { VideoTemplate } from '../types';

export const PHASE_28_VIDEO_TEMPLATES = [
  {
    id: 'explainer-with-lower-thirds',
    displayName: 'Explainer with lower thirds',
    category: 'explainer',
    thumbnailUrl: '',
    durationSec: { typical: 42, min: 30, max: 60 },
    aspectRatios: ['16:9', '9:16'],
    renderer: 'remotion',
    compositionId: 'ExplainerLowerThirdsTemplate',
    hook: 'question',
    pace: 'medium',
    pricingHint: { low: 1.5, high: 5 },
    inputs: [
      { key: 'topic', kind: 'text', label: 'Topic', required: true },
      { key: 'expert', kind: 'text', label: 'Expert name', default: 'Host' },
      {
        key: 'brandColor',
        kind: 'color',
        label: 'Brand color',
        default: '#0f766e',
      },
      { key: 'takeaway', kind: 'text', label: 'Takeaway', required: true },
    ],
    storyboardSeed: {
      intent: 'Explain {{topic}} with animated lower thirds',
      scenes: [
        {
          durationMs: 6000,
          intent: 'Question opener for {{topic}} with {{expert}} lower third.',
          caption: { text: 'What changes with {{topic}}?' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Editorial explainer title frame about {{topic}}, confident host lower third for {{expert}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '16:9',
          },
        },
        {
          durationMs: 11000,
          intent: 'Define the problem and introduce the expert: {{expert}}.',
          caption: { text: '{{expert}} breaks it down' },
          transition: 'fade',
          assetPlan: {
            kind: 'tts-narration',
            text: '{{expert}} explains the core problem behind {{topic}}.',
            provider: 'openai-tts',
          },
        },
        {
          durationMs: 13000,
          intent: 'Show three visual proof points for {{topic}}.',
          caption: { text: 'Three proof points' },
          transition: 'slide',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Clean motion graphics explainer sequence, three proof points for {{topic}}, brand accent {{brandColor}}',
            provider: 'seedance-2-0-fast',
            aspectRatio: '16:9',
            durationMs: 13000,
          },
        },
        {
          durationMs: 12000,
          intent: 'Close with the key takeaway: {{takeaway}}.',
          caption: { text: '{{takeaway}}' },
          transition: 'dissolve',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Clean closing explainer card, takeaway {{takeaway}}, brand accent {{brandColor}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '16:9',
          },
        },
      ],
      music: {
        provider: 'elevenlabs-music',
        prompt:
          'Modern restrained explainer bed, light pulse, confident but unobtrusive',
        durationMs: 42000,
        mood: 'focused',
      },
    },
    styleDefaults: {
      primaryColor: '{{brandColor}}',
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
    id: 'podcast-with-waveform',
    displayName: 'Podcast with waveform',
    category: 'podcast',
    thumbnailUrl: '',
    durationSec: { typical: 50, min: 30, max: 75 },
    aspectRatios: ['9:16', '1:1'],
    renderer: 'remotion',
    compositionId: 'PodcastWaveformTemplate',
    hook: 'cold-open',
    pace: 'medium',
    pricingHint: { low: 0.5, high: 2 },
    inputs: [
      { key: 'quote', kind: 'longText', label: 'Quote', required: true },
      { key: 'speaker', kind: 'text', label: 'Speaker', default: 'Guest' },
      { key: 'show', kind: 'text', label: 'Show', default: 'Podcast' },
      {
        key: 'brandColor',
        kind: 'color',
        label: 'Brand color',
        default: '#2563eb',
      },
    ],
    storyboardSeed: {
      intent: '{{show}} clip featuring {{speaker}}',
      scenes: [
        {
          durationMs: 6000,
          intent: 'Cold-open title card for {{speaker}} on {{show}}.',
          caption: { text: '{{speaker}}' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Podcast clip title card with clean waveform, {{speaker}}, {{show}}, brand color {{brandColor}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '9:16',
          },
        },
        {
          durationMs: 36000,
          intent: 'Main quote with waveform and captions: {{quote}}',
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
          intent: 'End card for {{show}}.',
          caption: { text: '{{show}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Podcast social end card for {{show}}, waveform motif, brand color {{brandColor}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '9:16',
          },
        },
      ],
    },
    styleDefaults: {
      primaryColor: '{{brandColor}}',
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
    id: 'product-tour-60s',
    displayName: 'Product tour · 60s',
    category: 'product',
    thumbnailUrl: '',
    durationSec: { typical: 60, min: 45, max: 90 },
    aspectRatios: ['16:9', '9:16'],
    renderer: 'ffmpeg',
    hook: 'reveal',
    pace: 'medium',
    pricingHint: { low: 1.5, high: 6 },
    inputs: [
      { key: 'product', kind: 'text', label: 'Product', required: true },
      { key: 'audience', kind: 'text', label: 'Audience', default: 'teams' },
      { key: 'workflow', kind: 'text', label: 'Workflow', required: true },
      {
        key: 'cta',
        kind: 'text',
        label: 'Call to action',
        default: 'Try it today',
      },
    ],
    storyboardSeed: {
      intent: '{{product}} tour for {{audience}}',
      scenes: [
        {
          durationMs: 7000,
          intent: 'Open with the problem {{product}} solves for {{audience}}.',
          caption: { text: 'Built for {{audience}}' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'SaaS product tour opener, {{product}}, audience {{audience}}, crisp interface mockup',
            provider: 'seedream-5-0-lite',
            aspectRatio: '16:9',
          },
        },
        {
          durationMs: 18000,
          intent: 'Walk through workflow: {{workflow}}.',
          caption: { text: '{{workflow}}' },
          transition: 'slide',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Polished product walkthrough, interface steps for {{workflow}}, {{product}}, smooth cursor movement',
            provider: 'seedance-2-0-fast',
            aspectRatio: '16:9',
            durationMs: 18000,
          },
        },
        {
          durationMs: 17000,
          intent: 'Show collaboration and measurable outcome.',
          caption: { text: 'From work to outcome' },
          transition: 'wipe',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Team collaboration product tour sequence, {{product}}, outcome dashboard, clean workspace',
            provider: 'seedance-2-0-fast',
            aspectRatio: '16:9',
            durationMs: 17000,
          },
        },
        {
          durationMs: 10000,
          intent: 'Pricing-safe value recap for {{audience}}.',
          caption: { text: 'Why it works' },
          transition: 'fade',
          assetPlan: {
            kind: 'tts-narration',
            text: '{{product}} helps {{audience}} complete {{workflow}} with less manual work.',
            provider: 'openai-tts',
          },
        },
        {
          durationMs: 8000,
          intent: 'CTA: {{cta}}.',
          caption: { text: '{{cta}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'ai-image',
            prompt: 'Clean product CTA screen for {{product}}, text {{cta}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '16:9',
          },
        },
      ],
    },
    styleDefaults: {
      primaryColor: '#0f172a',
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
    projectTemplateId: 'product-reel',
  },
  {
    id: 'social-vertical-momentum-20s',
    displayName: 'Social vertical momentum · 20s',
    category: 'shorts',
    thumbnailUrl: '',
    durationSec: { typical: 20, min: 15, max: 30 },
    aspectRatios: ['9:16'],
    renderer: 'ffmpeg',
    hook: 'pattern-interrupt',
    pace: 'extreme',
    pricingHint: { low: 0.75, high: 3 },
    inputs: [
      { key: 'hook', kind: 'text', label: 'Hook', required: true },
      { key: 'subject', kind: 'text', label: 'Subject', required: true },
      { key: 'payoff', kind: 'text', label: 'Payoff', required: true },
    ],
    storyboardSeed: {
      intent: '{{hook}} about {{subject}}',
      scenes: [
        {
          durationMs: 3000,
          intent: 'Immediate pattern interrupt: {{hook}}.',
          caption: { text: '{{hook}}' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Vertical social video pattern interrupt, bold opening visual for {{subject}}',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 3000,
          },
        },
        {
          durationMs: 5000,
          intent: 'Fast visual proof of {{subject}}.',
          caption: { text: 'Watch this' },
          transition: 'zoom-blur',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Fast vertical montage proving {{subject}}, sharp cuts, creator style',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 5000,
          },
        },
        {
          durationMs: 7000,
          intent: 'Turn the proof into payoff: {{payoff}}.',
          caption: { text: '{{payoff}}' },
          transition: 'slide',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Vertical payoff reveal for {{subject}}, energetic camera moves',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 7000,
          },
        },
        {
          durationMs: 5000,
          intent: 'Loopable end frame that restates {{hook}}.',
          caption: { text: '{{hook}}' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-image',
            prompt: 'Loopable vertical social end frame, {{subject}}, {{hook}}',
            provider: 'seedream-5-0-lite',
            aspectRatio: '9:16',
          },
        },
      ],
      music: {
        provider: 'stable-audio',
        prompt: 'Punchy vertical short beat, tight percussion, high energy',
        durationMs: 20000,
        mood: 'energetic',
      },
    },
    styleDefaults: {
      primaryColor: '#e11d48',
      fontFamily: 'Inter',
      captionStyle: { position: 'middle', animation: 'tiktok-word' },
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
    id: 'ugc-testimonial-30s',
    displayName: 'UGC testimonial · 30s',
    category: 'testimonial',
    thumbnailUrl: '',
    durationSec: { typical: 30, min: 20, max: 45 },
    aspectRatios: ['9:16', '4:5'],
    renderer: 'ffmpeg',
    hook: 'cold-open',
    pace: 'fast',
    pricingHint: { low: 1, high: 4 },
    inputs: [
      { key: 'product', kind: 'text', label: 'Product', required: true },
      { key: 'before', kind: 'text', label: 'Before state', required: true },
      { key: 'after', kind: 'text', label: 'After state', required: true },
      {
        key: 'proof',
        kind: 'text',
        label: 'Proof point',
        default: 'It worked fast',
      },
    ],
    storyboardSeed: {
      intent: 'UGC testimonial for {{product}}',
      scenes: [
        {
          durationMs: 5000,
          intent: 'Selfie cold open: {{before}}.',
          caption: { text: '{{before}}' },
          transition: 'cut',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Authentic vertical selfie testimonial opening, natural light, before state {{before}}, product {{product}}',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 5000,
          },
        },
        {
          durationMs: 8000,
          intent: 'Show product usage and transition from before to after.',
          caption: { text: '{{product}} changed the routine' },
          transition: 'cover',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'UGC product usage demo, {{product}}, moving from {{before}} to {{after}}, handheld',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 8000,
          },
        },
        {
          durationMs: 9000,
          intent: 'Proof point: {{proof}}.',
          caption: { text: '{{proof}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'ai-clip',
            prompt:
              'Natural testimonial proof moment, product {{product}}, proof {{proof}}, believable UGC',
            provider: 'seedance-2-0-fast',
            aspectRatio: '9:16',
            durationMs: 9000,
          },
        },
        {
          durationMs: 8000,
          intent: 'After state and recommendation: {{after}}.',
          caption: { text: '{{after}}' },
          transition: 'fade',
          assetPlan: {
            kind: 'ai-image',
            prompt:
              'Vertical UGC end card for {{product}}, after state {{after}}, natural social style',
            provider: 'seedream-5-0-lite',
            aspectRatio: '9:16',
          },
        },
      ],
      music: {
        provider: 'elevenlabs-music',
        prompt: 'Warm optimistic testimonial bed, soft beat, creator friendly',
        durationMs: 30000,
        mood: 'warm',
      },
    },
    styleDefaults: {
      primaryColor: '#16a34a',
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
] satisfies VideoTemplate[];
