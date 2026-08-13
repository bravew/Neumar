import { z } from 'zod';

export const DOC_MEDIA_LOCALES = ['en', 'zh', 'es', 'fr', 'hi', 'pt'] as const;
export type DocMediaLocale = (typeof DOC_MEDIA_LOCALES)[number];

const localeTextSchema = z.object({
  en: z.string().min(1),
  zh: z.string().min(1),
  es: z.string().min(1),
  fr: z.string().min(1),
  hi: z.string().min(1),
  pt: z.string().min(1),
});

const localizedCopySchema = z
  .object({
    alt: localeTextSchema.optional(),
    caption: localeTextSchema.optional(),
    transcript: localeTextSchema.optional(),
  })
  .default({});

const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const captureProfileSchema = z
  .object({
    viewport: viewportSchema.optional(),
    deviceScaleFactor: z.number().min(1).default(2),
    colorScheme: z.enum(['dark', 'light', 'no-preference']).default('dark'),
    reducedMotion: z.enum(['reduce', 'no-preference']).default('reduce'),
    forcedColors: z.enum(['active', 'none']).default('none'),
    recordVideo: z
      .object({
        size: viewportSchema.optional(),
      })
      .optional(),
  })
  .default({
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    forcedColors: 'none',
  });

const privacyMaskSchema = z.object({
  selector: z.string().min(1),
  replacement: z.string().min(1).default('[redacted]'),
});

const stepSchema = z.object({
  label: z.string().min(1),
  action: z.enum([
    'clear-state-reload',
    'click',
    'fill',
    'navigate',
    'scroll',
    'type',
    'wait',
  ]),
  selector: z.string().min(1).optional(),
  value: z.string().optional(),
  url: z.string().optional(),
  ms: z.number().int().positive().optional(),
  typeDelay: z.number().int().positive().optional(),
});

const cameraSchema = z
  .object({
    fps: z.number().int().positive().default(30),
    durationMs: z.number().int().positive().optional(),
    sourceStartMs: z.number().int().nonnegative().default(2_200),
    zooms: z
      .array(
        z.object({
          label: z.string().min(1),
          targetX: z.number().min(0).max(1),
          targetY: z.number().min(0).max(1),
          zoomLevel: z.number().min(1),
          fromMs: z.number().int().nonnegative(),
          durationMs: z.number().int().positive(),
          holdMs: z.number().int().positive().optional(),
        }),
      )
      .default([]),
  })
  .default({
    fps: 30,
    sourceStartMs: 2_200,
    zooms: [],
  });

const rendererSchema = z
  .object({
    primary: z.enum(['remotion', 'hyperframes']).default('remotion'),
    compare: z.boolean().default(false),
    hyperframes: z
      .object({
        projectDir: z.string().min(1).optional(),
        generatedProject: z.boolean().default(true),
        snapshotAtMs: z.array(z.number().int().nonnegative()).default([]),
        docker: z.boolean().default(false),
      })
      .optional(),
  })
  .default({
    primary: 'remotion',
    compare: false,
  });

const budgetsSchema = z.object({
  maxBytes: z.number().int().positive(),
  maxDurationMs: z.number().int().positive().optional(),
});

const baseSpecSchema = z.object({
  id: z.string().min(1),
  page: z.string().min(1),
  slot: z.string().min(1),
  title: z.string().min(1),
  intent: z.string().min(1),
  route: z.string().startsWith('/'),
  seed: z.enum(['docs.empty', 'docs.populated', 'docs.streaming']),
  priority: z.enum(['required', 'nice-to-have', 'defer']).default('required'),
  surfaces: z.array(z.enum(['docs', 'landing'])).min(1),
  owner: z.string().min(1),
  alt: z.string().min(1),
  caption: z.string().min(1),
  localized: localizedCopySchema,
  privacyMasks: z.array(privacyMaskSchema).default([]),
  viewport: viewportSchema.optional(),
  captureProfile: captureProfileSchema,
  theme: z.enum(['dark', 'light']).default('dark'),
  waitFor: z.string().min(1).optional(),
  steps: z.array(stepSchema).default([]),
  effects: z.array(z.string()).default([]),
  budgets: budgetsSchema,
});

const imageSpecSchema = baseSpecSchema.extend({
  kind: z.literal('image'),
});

const videoSpecSchema = baseSpecSchema.extend({
  kind: z.literal('video'),
  transcript: z.string().min(1),
  poster: z.object({
    atMs: z.number().int().nonnegative(),
  }),
  steps: z.array(stepSchema).min(3),
  camera: cameraSchema,
  renderer: rendererSchema,
});

export const docMediaEntrySchema = z.discriminatedUnion('kind', [
  imageSpecSchema,
  videoSpecSchema,
]);

export const docMediaSchema = z.array(docMediaEntrySchema);

export type DocMediaConfigEntry = z.input<typeof docMediaEntrySchema>;
export type DocMediaEntry = z.output<typeof docMediaEntrySchema>;
export type DocMediaImageEntry = z.output<typeof imageSpecSchema>;
export type DocMediaVideoEntry = z.output<typeof videoSpecSchema>;
export type DocMediaStep = z.infer<typeof stepSchema>;
export type DocMediaPrivacyMask = z.infer<typeof privacyMaskSchema>;
export type DocMediaLocaleText = z.infer<typeof localeTextSchema>;

function allLocales(value: string): DocMediaLocaleText {
  return {
    en: value,
    zh: value,
    es: value,
    fr: value,
    hi: value,
    pt: value,
  };
}

function demoCopy(
  en: string,
  zh: string,
  es: string,
  fr: string,
  hi: string,
  pt: string,
) {
  return { en, zh, es, fr, hi, pt };
}

export const docMedia: DocMediaConfigEntry[] = [
  {
    id: 'desktop-app.hero',
    kind: 'image',
    page: 'desktop-app',
    slot: 'hero',
    title: 'Desktop app home',
    intent:
      'Show the primary desktop agent workspace with sidebar navigation, task composer, model controls, and quick actions.',
    route: '/',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Desktop app home screen with sidebar navigation and the central agent task composer.',
    caption:
      'The desktop app centers daily agent work around a workspace-aware task composer and persistent navigation.',
    waitFor: '[data-testid="home-page"]',
    budgets: {
      maxBytes: 360_000,
    },
  },
  {
    id: 'agent-system.hero',
    kind: 'image',
    page: 'agent-system',
    slot: 'hero',
    title: 'Agent task thread',
    intent:
      'Show the task detail surface where agent planning, messages, tools, and workspace context are reviewed.',
    route: '/task/docs-task-triage',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Task detail page showing an agent thread and workspace panels.',
    caption:
      'Agent runs stay inspectable in a task thread with conversation history, runtime status, and workspace context.',
    waitFor: '[data-testid="task-detail-page"]',
    budgets: {
      maxBytes: 380_000,
    },
  },
  {
    id: 'automations.hero',
    kind: 'image',
    page: 'automations',
    slot: 'hero',
    title: 'Automations dashboard',
    intent:
      'Show where scheduled, webhook, heartbeat, and manual automations are managed.',
    route: '/automation',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Automations page with automation templates and creation controls.',
    caption:
      'Automations turn repeatable prompts into scheduled or event-triggered agent runs.',
    waitFor: '[data-testid="automation-page"]',
    budgets: {
      maxBytes: 360_000,
    },
  },
  {
    id: 'design-mode.hero',
    kind: 'image',
    page: 'design-mode',
    slot: 'hero',
    title: 'DesignMode project start',
    intent:
      'Show the structured DesignMode entry screen with local project setup, surfaces, and reusable design assets.',
    route: '/design',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'DesignMode entry screen with surface tabs and a new project panel.',
    caption:
      'DesignMode starts from a local project brief, then adds surface-specific controls and reusable design context.',
    waitFor: '[data-testid="design-entry-view"]',
    budgets: {
      maxBytes: 420_000,
    },
  },
  {
    id: 'linear-pipeline.hero',
    kind: 'image',
    page: 'linear-pipeline',
    slot: 'hero',
    title: 'Pipeline dashboard',
    intent:
      'Show the operational dashboard used to monitor autonomous work, task flow, activity, and cost.',
    route: '/dashboard',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Dashboard showing task stats, recent activity, task flow, and cost summary panels.',
    caption:
      'The dashboard gives autonomous pipeline runs a quick operational readout across task status, activity, and spend.',
    waitFor: '[data-testid="dashboard-page"]',
    budgets: {
      maxBytes: 360_000,
    },
  },
  {
    id: 'mcp-and-skills.hero',
    kind: 'image',
    page: 'mcp-and-skills',
    slot: 'hero',
    title: 'Skills marketplace',
    intent:
      'Show where MCP-related plugins and skills are discovered and installed.',
    route: '/library?tab=marketplace',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Library marketplace tab for browsing available plugins and skills.',
    caption:
      'The Library marketplace is the app surface for discovering installable skills and plugin capabilities.',
    waitFor: '[data-testid="library-page"]',
    budgets: {
      maxBytes: 360_000,
    },
  },
  {
    id: 'cloud-storage.hero',
    kind: 'image',
    page: 'cloud-storage',
    slot: 'hero',
    title: 'Connected cloud storage browser',
    intent:
      'Show the Library cloud storage tab with connected media sources, search, and attachable assets.',
    route: '/library?tab=cloud-storage',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Library cloud storage tab showing connected media sources and browsable assets.',
    caption:
      'Cloud storage connections let agents browse, attach, and publish media without leaving the desktop workflow.',
    localized: {
      alt: allLocales(
        'Library cloud storage tab showing connected media sources and browsable assets.',
      ),
      caption: allLocales(
        'Cloud storage connections let agents browse, attach, and publish media without leaving the desktop workflow.',
      ),
    },
    waitFor: '[data-testid="library-page"]',
    steps: [
      {
        label: 'Open cloud storage tab',
        action: 'click',
        selector: '[data-testid="library-tab-cloud-storage"]',
      },
      {
        label: 'Pause on connected media sources',
        action: 'wait',
        ms: 500,
      },
    ],
    budgets: {
      maxBytes: 360_000,
    },
  },
  {
    id: 'media-generation.hero',
    kind: 'image',
    page: 'media-generation',
    slot: 'hero',
    title: 'DesignMode image project',
    intent:
      'Show the media-specific controls used to start an image generation project.',
    route: '/design',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'DesignMode image project setup with model and aspect ratio controls.',
    caption:
      'Media generation projects expose image and video controls directly in DesignMode before the agent starts work.',
    waitFor: '[data-testid="new-project-panel"]',
    steps: [
      {
        label: 'Open the surface picker',
        action: 'click',
        selector: '[data-testid="design-surface-picker"]',
      },
      {
        label: 'Switch to the image surface',
        action: 'click',
        selector: '[data-testid="design-surface-image"]',
      },
      {
        label: 'Pause on image generation controls',
        action: 'wait',
        ms: 500,
      },
    ],
    budgets: {
      maxBytes: 420_000,
    },
  },
  {
    id: 'memory-system.hero',
    kind: 'image',
    page: 'memory-system',
    slot: 'hero',
    title: 'Knowledge graph view',
    intent:
      'Show the Library knowledge graph surface used to inspect memory and codebase relationships.',
    route: '/library?tab=graph',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Library knowledge graph tab with graph status and rebuild controls.',
    caption:
      'The knowledge graph view makes long-term memory and workspace relationships inspectable from the Library.',
    waitFor: '[data-testid="library-page"]',
    budgets: {
      maxBytes: 360_000,
    },
  },
  {
    id: 'slash-commands.hero',
    kind: 'image',
    page: 'slash-commands',
    slot: 'hero',
    title: 'Slash command menu',
    intent: 'Show the keyboard command menu opened from the task composer.',
    route: '/',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Slash command menu open above the desktop app task composer.',
    caption:
      'Slash commands keep navigation, model switching, workspace controls, and exports close to the keyboard.',
    waitFor: '[data-testid="chat-input-textarea"]',
    steps: [
      {
        label: 'Open the slash command menu',
        action: 'type',
        selector: '[data-testid="chat-input-textarea"]',
        value: '/',
      },
      {
        label: 'Pause on slash commands',
        action: 'wait',
        ms: 500,
      },
    ],
    budgets: {
      maxBytes: 360_000,
    },
  },
  {
    id: 'workspace-security.hero',
    kind: 'image',
    page: 'workspace-security',
    slot: 'hero',
    title: 'Approvals inbox',
    intent:
      'Show the human-in-the-loop approvals surface for sensitive actions and permission decisions.',
    route: '/approvals',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Approvals page for reviewing sensitive agent actions and history.',
    caption:
      'Workspace security includes explicit approval surfaces for sensitive operations and permission decisions.',
    waitFor: '[data-testid="approvals-page"]',
    budgets: {
      maxBytes: 360_000,
    },
  },
  {
    id: 'linear-pipeline.pipeline-review',
    kind: 'video',
    page: 'linear-pipeline',
    slot: 'pipeline-review',
    title: 'Review autonomous pipeline health',
    intent:
      'Demonstrate how the dashboard summarizes agent pipeline status, recent activity, task flow, and spend.',
    route: '/dashboard',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of the pipeline dashboard with task status, activity, task flow, and cost panels.',
    caption:
      'Pipeline review starts with operational status, then moves through activity, task flow, and cost so autonomous work stays observable.',
    transcript:
      'The demo opens the dashboard, pauses on live task status, scrolls through recent activity and task flow, and returns to the cost summary for an operational review.',
    waitFor: '[data-testid="dashboard-page"]',
    steps: [
      {
        label: 'Pause on pipeline status',
        action: 'wait',
        ms: 1600,
      },
      {
        label: 'Scroll through operational panels',
        action: 'scroll',
        ms: 720,
      },
      {
        label: 'Hold on dashboard review',
        action: 'wait',
        ms: 2200,
      },
    ],
    poster: {
      atMs: 1800,
    },
    camera: {
      fps: 30,
      durationMs: 16_000,
      zooms: [
        {
          label: 'Establish pipeline dashboard',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 900,
        },
        {
          label: 'Focus task status cards',
          targetX: 0.52,
          targetY: 0.23,
          zoomLevel: 1.22,
          fromMs: 1800,
          durationMs: 750,
          holdMs: 1800,
        },
        {
          label: 'Focus activity and flow',
          targetX: 0.52,
          targetY: 0.55,
          zoomLevel: 1.2,
          fromMs: 5900,
          durationMs: 750,
          holdMs: 1700,
        },
        {
          label: 'Release to full dashboard',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 11_400,
          durationMs: 700,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1800, 5400, 10_000, 15_500],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_800_000,
      maxDurationMs: 16_500,
    },
  },
  {
    id: 'mcp-and-skills.marketplace-review',
    kind: 'video',
    page: 'mcp-and-skills',
    slot: 'marketplace-review',
    title: 'Discover agent capabilities',
    intent:
      'Demonstrate using the Library marketplace to find installable skills and MCP-backed plugin capabilities.',
    route: '/library?tab=marketplace',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of searching the marketplace for installable agent plugins and skills.',
    caption:
      'Capability discovery belongs in the flow: search the marketplace, inspect skill counts, and decide what the agent can safely use.',
    transcript:
      'The demo opens the marketplace, searches for a GitHub capability, and pauses on filtered plugin cards that expose installable skills for the agent.',
    waitFor: '[data-testid="library-page"]',
    steps: [
      {
        label: 'Pause on the marketplace',
        action: 'wait',
        ms: 1500,
      },
      {
        label: 'Search for a GitHub capability',
        action: 'type',
        selector: '[data-testid="marketplace-search-input"]',
        value: 'github',
        typeDelay: 45,
      },
      {
        label: 'Hold on filtered capabilities',
        action: 'wait',
        ms: 2200,
      },
    ],
    poster: {
      atMs: 1900,
    },
    camera: {
      fps: 30,
      durationMs: 18_500,
      zooms: [
        {
          label: 'Establish Library marketplace',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 900,
        },
        {
          label: 'Focus capability search',
          targetX: 0.52,
          targetY: 0.25,
          zoomLevel: 1.26,
          fromMs: 1800,
          durationMs: 750,
          holdMs: 1700,
        },
        {
          label: 'Focus filtered plugin card',
          targetX: 0.36,
          targetY: 0.45,
          zoomLevel: 1.26,
          fromMs: 6200,
          durationMs: 750,
          holdMs: 1900,
        },
        {
          label: 'Release to marketplace context',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 11_400,
          durationMs: 700,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1800, 5400, 10_000, 15_500, 18_000],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_800_000,
      maxDurationMs: 19_000,
    },
  },
  {
    id: 'cloud-storage.browse-attach',
    kind: 'video',
    page: 'cloud-storage',
    slot: 'browse-attach',
    title: 'Browse connected media context',
    intent:
      'Demonstrate browsing connected cloud media, searching assets, and keeping attachable context in the desktop workflow.',
    route: '/library?tab=cloud-storage',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of browsing a connected cloud media library and searching attachable assets.',
    caption:
      'Connected media stays close to the agent: pick a source, search assets, and attach context without leaving the desktop app.',
    transcript:
      'The demo opens the cloud storage tab, pauses on the connected media source, searches for launch assets, and holds on the returned media grid.',
    waitFor: '[data-testid="library-page"]',
    steps: [
      {
        label: 'Open cloud storage tab',
        action: 'click',
        selector: '[data-testid="library-tab-cloud-storage"]',
      },
      {
        label: 'Pause on connected media source',
        action: 'wait',
        ms: 1600,
      },
      {
        label: 'Search cloud media',
        action: 'type',
        selector: '[data-testid="cloud-storage-search-input"]',
        value: 'launch',
        typeDelay: 45,
      },
      {
        label: 'Hold on media results',
        action: 'wait',
        ms: 2200,
      },
    ],
    poster: {
      atMs: 1900,
    },
    camera: {
      fps: 30,
      durationMs: 18_500,
      zooms: [
        {
          label: 'Establish cloud storage tab',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 900,
        },
        {
          label: 'Focus connected source',
          targetX: 0.34,
          targetY: 0.21,
          zoomLevel: 1.24,
          fromMs: 1800,
          durationMs: 750,
          holdMs: 1700,
        },
        {
          label: 'Focus media search and filters',
          targetX: 0.52,
          targetY: 0.34,
          zoomLevel: 1.26,
          fromMs: 6200,
          durationMs: 750,
          holdMs: 1900,
        },
        {
          label: 'Release to media grid',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 11_400,
          durationMs: 700,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1800, 5400, 10_000, 15_500, 18_000],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_800_000,
      maxDurationMs: 19_000,
    },
  },
  {
    id: 'memory-system.graph-review',
    kind: 'video',
    page: 'memory-system',
    slot: 'graph-review',
    title: 'Review workspace memory',
    intent:
      'Demonstrate the knowledge graph surface that keeps agent memory and workspace relationships inspectable.',
    route: '/library?tab=graph',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of reviewing the knowledge graph tab for workspace memory and graph status.',
    caption:
      'Memory is inspectable: the graph view exposes rebuild status, report summaries, and the workspace relationships agents use.',
    transcript:
      'The demo opens the knowledge graph tab, pauses on graph status and rebuild controls, scrolls into the report summary, and returns to the memory surface.',
    waitFor: '[data-testid="library-page"]',
    steps: [
      {
        label: 'Pause on graph status',
        action: 'wait',
        ms: 1600,
      },
      {
        label: 'Scroll into the graph report',
        action: 'scroll',
        ms: 720,
      },
      {
        label: 'Hold on memory report',
        action: 'wait',
        ms: 2200,
      },
    ],
    poster: {
      atMs: 1900,
    },
    camera: {
      fps: 30,
      durationMs: 16_000,
      zooms: [
        {
          label: 'Establish knowledge graph',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 900,
        },
        {
          label: 'Focus graph status',
          targetX: 0.52,
          targetY: 0.25,
          zoomLevel: 1.22,
          fromMs: 1800,
          durationMs: 750,
          holdMs: 1700,
        },
        {
          label: 'Focus report context',
          targetX: 0.52,
          targetY: 0.58,
          zoomLevel: 1.2,
          fromMs: 6200,
          durationMs: 750,
          holdMs: 1900,
        },
        {
          label: 'Release to memory surface',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 11_400,
          durationMs: 700,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1800, 5400, 10_000, 15_500],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_800_000,
      maxDurationMs: 16_500,
    },
  },
  {
    id: 'slash-commands.command-menu',
    kind: 'video',
    page: 'slash-commands',
    slot: 'command-menu',
    title: 'Use slash commands from the composer',
    intent:
      'Demonstrate keyboard-first command discovery from the task composer.',
    route: '/',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of opening and filtering slash commands above the task composer.',
    caption:
      'Slash commands keep mode switches, workspace actions, exports, and settings available without breaking task flow.',
    transcript:
      'The demo focuses the home composer, types a slash command prefix, and pauses on the filtered command menu above the task input.',
    waitFor: '[data-testid="chat-input-textarea"]',
    steps: [
      {
        label: 'Focus the composer',
        action: 'click',
        selector: '[data-testid="chat-input-textarea"]',
      },
      {
        label: 'Type a command prefix',
        action: 'type',
        selector: '[data-testid="chat-input-textarea"]',
        value: '/settings',
        typeDelay: 65,
      },
      {
        label: 'Hold on filtered command menu',
        action: 'wait',
        ms: 2200,
      },
    ],
    poster: {
      atMs: 1800,
    },
    camera: {
      fps: 30,
      durationMs: 18_500,
      zooms: [
        {
          label: 'Establish home workspace',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 900,
        },
        {
          label: 'Focus composer commands',
          targetX: 0.5,
          targetY: 0.76,
          zoomLevel: 1.3,
          fromMs: 1800,
          durationMs: 750,
          holdMs: 1900,
        },
        {
          label: 'Focus filtered command list',
          targetX: 0.36,
          targetY: 0.48,
          zoomLevel: 1.32,
          fromMs: 6200,
          durationMs: 750,
          holdMs: 1900,
        },
        {
          label: 'Release to task composer',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 11_400,
          durationMs: 700,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1800, 5400, 10_000, 15_500, 18_000],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_800_000,
      maxDurationMs: 19_000,
    },
  },
  {
    id: 'workspace-security.approvals-review',
    kind: 'video',
    page: 'workspace-security',
    slot: 'approvals-review',
    title: 'Review a sensitive agent action',
    intent:
      'Demonstrate human-in-the-loop approval for a sensitive plan before the agent proceeds.',
    route: '/approvals',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of reviewing a pending approval with risk level, plan details, and approve or reject controls.',
    caption:
      'Agentic autonomy stays bounded by explicit approvals for sensitive work, with risk, context, and decision controls visible together.',
    transcript:
      'The demo opens Approvals, pauses on a pending plan request, highlights risk and plan context, and holds on the approve or reject decision controls.',
    waitFor: '[data-testid="approvals-page"]',
    steps: [
      {
        label: 'Pause on pending approval',
        action: 'wait',
        ms: 1600,
      },
      {
        label: 'Scroll approval context',
        action: 'scroll',
        ms: 720,
      },
      {
        label: 'Hold on decision controls',
        action: 'wait',
        ms: 2200,
      },
    ],
    poster: {
      atMs: 1900,
    },
    camera: {
      fps: 30,
      durationMs: 18_500,
      zooms: [
        {
          label: 'Establish approvals inbox',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 900,
        },
        {
          label: 'Focus pending approval',
          targetX: 0.46,
          targetY: 0.34,
          zoomLevel: 1.26,
          fromMs: 1800,
          durationMs: 750,
          holdMs: 1700,
        },
        {
          label: 'Focus risk and plan context',
          targetX: 0.46,
          targetY: 0.47,
          zoomLevel: 1.28,
          fromMs: 6200,
          durationMs: 750,
          holdMs: 1900,
        },
        {
          label: 'Release to decision controls',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 11_400,
          durationMs: 700,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1800, 5400, 10_000, 15_500, 18_000],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_800_000,
      maxDurationMs: 19_000,
    },
  },
  {
    id: 'desktop-app.first-task',
    kind: 'video',
    page: 'desktop-app',
    slot: 'first-task',
    title: 'Create a launch post and image task',
    intent:
      'Demonstrate starting a new chat with an agentic marketing task that asks for X post copy and an accompanying generated image concept.',
    route: '/',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Demo of starting a new chat that asks the agent to create an X post and image concept.',
    caption:
      'A new chat can combine planning, copywriting, and media direction in one agentic task.',
    transcript:
      'The demo opens the desktop app, starts from the home composer, types an X post request with image generation direction, reviews the prompt, and submits it as a new agent task.',
    localized: {
      alt: allLocales(
        'Demo of starting a new chat that asks the agent to create an X post and image concept.',
      ),
      caption: demoCopy(
        'A new chat can combine planning, copywriting, and media direction in one agentic task.',
        '一个新聊天可以把规划、文案和媒体方向合并到同一个代理任务中。',
        'Un nuevo chat puede combinar planificación, redacción y dirección visual en una sola tarea agentic.',
        'Un nouveau chat peut combiner planification, rédaction et direction média dans une seule tâche agentique.',
        'नया चैट योजना, कॉपी और मीडिया दिशा को एक एजेंटिक कार्य में जोड़ सकता है।',
        'Um novo chat pode combinar planejamento, copywriting e direção de mídia em uma única tarefa agentic.',
      ),
      transcript: demoCopy(
        'The demo opens the desktop app, starts from the home composer, types an X post request with image generation direction, reviews the prompt, and submits it as a new agent task.',
        '演示打开桌面应用，从主页输入框开始，输入带有图像生成方向的 X 帖子请求，检查提示并作为新代理任务提交。',
        'La demostración abre la app, usa el compositor principal, escribe una solicitud de publicación para X con dirección de imagen, revisa el prompt y la envía como nueva tarea.',
        "La démo ouvre l'application, part du compositeur, saisit une demande de post X avec direction d'image, relit le prompt puis le lance comme tâche d'agent.",
        'डेमो ऐप खोलता है, होम कंपोज़र से X पोस्ट और इमेज दिशा वाला अनुरोध लिखता है, prompt की समीक्षा करता है और उसे नए एजेंट कार्य के रूप में भेजता है।',
        'A demonstração abre o app, usa o compositor inicial, escreve um pedido de post para X com direção de imagem, revisa o prompt e envia como nova tarefa.',
      ),
    },
    privacyMasks: [
      {
        selector: '[data-testid="workspace-path"]',
        replacement: '~/work/acme-support',
      },
    ],
    waitFor: '[data-testid="home-page"]',
    steps: [
      {
        label: 'Pause on the new chat workspace',
        action: 'wait',
        ms: 800,
      },
      {
        label: 'Focus the task composer',
        action: 'click',
        selector: '[data-testid="chat-input-textarea"]',
      },
      {
        label: 'Type an agentic launch request',
        action: 'type',
        selector: '[data-testid="chat-input-textarea"]',
        value:
          'Create an X post announcing our agentic AI desktop workspace. Draft the post copy, hashtags, and generate a 16:9 product image concept to publish with it.',
        typeDelay: 38,
      },
      {
        label: 'Review the prompt and visible controls',
        action: 'wait',
        ms: 1000,
      },
      {
        label: 'Start the task',
        action: 'click',
        selector: '[data-testid="chat-submit-button"]',
      },
      {
        label: 'Let the new task persist',
        action: 'wait',
        ms: 1000,
      },
      {
        label: 'Reopen the created task transcript',
        action: 'clear-state-reload',
      },
      {
        label: 'Review the running task context',
        action: 'wait',
        ms: 2400,
      },
    ],
    poster: {
      atMs: 5200,
    },
    camera: {
      fps: 30,
      durationMs: 18_000,
      zooms: [
        {
          label: 'Establish the home workspace',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 900,
        },
        {
          label: 'Focus the new chat composer',
          targetX: 0.5,
          targetY: 0.78,
          zoomLevel: 1.28,
          fromMs: 1600,
          durationMs: 700,
          holdMs: 2500,
        },
        {
          label: 'Focus the full agentic request',
          targetX: 0.5,
          targetY: 0.78,
          zoomLevel: 1.34,
          fromMs: 6200,
          durationMs: 650,
          holdMs: 1700,
        },
        {
          label: 'Focus the submit control',
          targetX: 0.82,
          targetY: 0.83,
          zoomLevel: 1.32,
          fromMs: 9300,
          durationMs: 650,
          holdMs: 900,
        },
        {
          label: 'Release to the task surface',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 12_200,
          durationMs: 650,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1600, 5200, 9600, 14_500, 17_200],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 3_600_000,
      maxDurationMs: 18_500,
    },
  },
  {
    id: 'desktop-app.settings-walkthrough',
    kind: 'video',
    page: 'desktop-app',
    slot: 'settings-walkthrough',
    title: 'Walk through settings tabs',
    intent:
      'Demonstrate opening Settings from the composer and moving through the major configuration areas users need to understand.',
    route: '/',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Demo of opening Settings from slash commands and moving through major settings tabs.',
    caption:
      'Settings centralizes providers, runtimes, MCP, skills, integrations, memory, speech, search, publishing, usage, and safety controls.',
    transcript:
      'The demo opens the slash command menu, selects the MCP settings shortcut, and walks through account, general, connector, channels, model, runtime, MCP, skills, modes, DesignMode, memory, speech, search, keyboard, publish, usage, workplace, theme, profiles, permissions, hooks, secrets, data, advanced, and about tabs.',
    localized: {
      alt: allLocales(
        'Demo of opening Settings from slash commands and moving through major settings tabs.',
      ),
      caption: demoCopy(
        'Settings centralizes providers, runtimes, MCP, skills, integrations, memory, speech, search, publishing, usage, and safety controls.',
        '设置集中管理提供商、运行时、MCP、技能、集成、记忆、语音、搜索、发布、用量和安全控制。',
        'Configuración reúne proveedores, runtimes, MCP, skills, integraciones, memoria, voz, búsqueda, publicación, uso y seguridad.',
        'Les paramètres regroupent fournisseurs, runtimes, MCP, skills, intégrations, mémoire, voix, recherche, publication, usage et sécurité.',
        'Settings में providers, runtimes, MCP, skills, integrations, memory, speech, search, publishing, usage और safety controls एक जगह मिलते हैं।',
        'Configurações reúne provedores, runtimes, MCP, skills, integrações, memória, voz, busca, publicação, uso e segurança.',
      ),
      transcript: demoCopy(
        'The demo opens the slash command menu, selects the MCP settings shortcut, and walks through account, general, connector, channels, model, runtime, MCP, skills, modes, DesignMode, memory, speech, search, keyboard, publish, usage, workplace, theme, profiles, permissions, hooks, secrets, data, advanced, and about tabs.',
        '演示打开斜杠菜单，选择 MCP 设置快捷入口，并依次查看账户、常规、连接器、频道、模型、运行时、MCP、技能、模式、DesignMode、记忆、语音、搜索、键盘、发布、用量、工作区、主题、配置文件、权限、Hooks、密钥、数据、高级和关于标签。',
        'La demostración abre el menú slash, elige el acceso directo de MCP y recorre Cuenta, General, Conectores, Canales, Modelos, Runtimes, MCP, Skills, Modos, DesignMode, Memoria, Voz, Búsqueda, Teclado, Publicación, Uso, Workplace, Tema, Perfiles, Permisos, Hooks, Secretos, Datos, Avanzado y Acerca de.',
        'La démo ouvre le menu slash, choisit le raccourci MCP, puis parcourt Compte, Général, Connecteurs, Canaux, Modèles, Runtimes, MCP, Skills, Modes, DesignMode, Mémoire, Voix, Recherche, Clavier, Publication, Usage, Workplace, Thème, Profils, Permissions, Hooks, Secrets, Données, Avancé et À propos.',
        'डेमो slash menu खोलता है, MCP settings shortcut चुनता है और Account, General, Connector, Channels, Model, Runtime, MCP, Skills, Modes, DesignMode, Memory, Speech, Search, Keyboard, Publish, Usage, Workplace, Theme, Profiles, Permissions, Hooks, Secrets, Data, Advanced और About tabs दिखाता है।',
        'A demonstração abre o menu slash, escolhe o atalho de MCP e passa por Conta, Geral, Conectores, Canais, Modelos, Runtimes, MCP, Skills, Modos, DesignMode, Memória, Voz, Busca, Teclado, Publicação, Uso, Workplace, Tema, Perfis, Permissões, Hooks, Segredos, Dados, Avançado e Sobre.',
      ),
    },
    waitFor: '[data-testid="chat-input-textarea"]',
    steps: [
      {
        label: 'Focus the composer',
        action: 'click',
        selector: '[data-testid="chat-input-textarea"]',
      },
      {
        label: 'Open the MCP settings shortcut',
        action: 'type',
        selector: '[data-testid="chat-input-textarea"]',
        value: '/mcp',
        typeDelay: 45,
      },
      {
        label: 'Select the settings command',
        action: 'click',
        selector: '[data-testid="slash-command-menu"] button',
      },
      {
        label: 'Hold on MCP settings',
        action: 'wait',
        ms: 900,
      },
      {
        label: 'Open Account settings',
        action: 'click',
        selector: '[data-testid="settings-nav-account"]',
      },
      {
        label: 'Pause on Account settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open General settings',
        action: 'click',
        selector: '[data-testid="settings-nav-general"]',
      },
      {
        label: 'Pause on General settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Model settings',
        action: 'click',
        selector: '[data-testid="settings-nav-model"]',
      },
      {
        label: 'Pause on Model settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open runtime settings',
        action: 'click',
        selector: '[data-testid="settings-nav-agentRuntimes"]',
      },
      {
        label: 'Pause on runtime settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Return to MCP settings',
        action: 'click',
        selector: '[data-testid="settings-nav-mcp"]',
      },
      {
        label: 'Pause on MCP settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Skills settings',
        action: 'click',
        selector: '[data-testid="settings-nav-skills"]',
      },
      {
        label: 'Pause on Skills settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Modes settings',
        action: 'click',
        selector: '[data-testid="settings-nav-modes"]',
      },
      {
        label: 'Pause on Modes settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open DesignMode settings',
        action: 'click',
        selector: '[data-testid="settings-nav-designMode"]',
      },
      {
        label: 'Pause on DesignMode settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open Connector settings',
        action: 'click',
        selector: '[data-testid="settings-nav-connector"]',
      },
      {
        label: 'Pause on Connector settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Channel settings',
        action: 'click',
        selector: '[data-testid="settings-nav-channels"]',
      },
      {
        label: 'Pause on Channel settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Memory settings',
        action: 'click',
        selector: '[data-testid="settings-nav-memory"]',
      },
      {
        label: 'Pause on Memory settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Speech settings',
        action: 'click',
        selector: '[data-testid="settings-nav-speech"]',
      },
      {
        label: 'Pause on Speech settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Search settings',
        action: 'click',
        selector: '[data-testid="settings-nav-search"]',
      },
      {
        label: 'Pause on Search settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Keyboard settings',
        action: 'click',
        selector: '[data-testid="settings-nav-keyboard"]',
      },
      {
        label: 'Pause on Keyboard settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Publish settings',
        action: 'click',
        selector: '[data-testid="settings-nav-publish"]',
      },
      {
        label: 'Pause on Publish settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Usage settings',
        action: 'click',
        selector: '[data-testid="settings-nav-usage"]',
      },
      {
        label: 'Pause on Usage settings',
        action: 'wait',
        ms: 550,
      },
      {
        label: 'Open Workplace settings',
        action: 'click',
        selector: '[data-testid="settings-nav-workplace"]',
      },
      {
        label: 'Pause on Workplace settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open Theme settings',
        action: 'click',
        selector: '[data-testid="settings-nav-theme"]',
      },
      {
        label: 'Pause on Theme settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open Profiles settings',
        action: 'click',
        selector: '[data-testid="settings-nav-profiles"]',
      },
      {
        label: 'Pause on Profiles settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open Permissions settings',
        action: 'click',
        selector: '[data-testid="settings-nav-permissions"]',
      },
      {
        label: 'Pause on Permissions settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open Hooks settings',
        action: 'click',
        selector: '[data-testid="settings-nav-hooks"]',
      },
      {
        label: 'Pause on Hooks settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open Secrets settings',
        action: 'click',
        selector: '[data-testid="settings-nav-secrets"]',
      },
      {
        label: 'Pause on Secrets settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open Data settings',
        action: 'click',
        selector: '[data-testid="settings-nav-data"]',
      },
      {
        label: 'Pause on Data settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open Advanced settings',
        action: 'click',
        selector: '[data-testid="settings-nav-advanced"]',
      },
      {
        label: 'Pause on Advanced settings',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Open About settings',
        action: 'click',
        selector: '[data-testid="settings-nav-about"]',
      },
      {
        label: 'Hold on About settings',
        action: 'wait',
        ms: 1200,
      },
    ],
    poster: {
      atMs: 4200,
    },
    camera: {
      fps: 30,
      durationMs: 28_000,
      zooms: [
        {
          label: 'Open settings from the composer',
          targetX: 0.5,
          targetY: 0.76,
          zoomLevel: 1.24,
          fromMs: 0,
          durationMs: 600,
          holdMs: 900,
        },
        {
          label: 'Focus the settings navigation',
          targetX: 0.2,
          targetY: 0.48,
          zoomLevel: 1.22,
          fromMs: 3800,
          durationMs: 650,
          holdMs: 2400,
        },
        {
          label: 'Focus model and runtime configuration',
          targetX: 0.58,
          targetY: 0.42,
          zoomLevel: 1.16,
          fromMs: 8200,
          durationMs: 650,
          holdMs: 2400,
        },
        {
          label: 'Focus integrations and memory',
          targetX: 0.58,
          targetY: 0.42,
          zoomLevel: 1.16,
          fromMs: 12_600,
          durationMs: 650,
          holdMs: 2400,
        },
        {
          label: 'Focus workplace and appearance',
          targetX: 0.58,
          targetY: 0.42,
          zoomLevel: 1.16,
          fromMs: 17_000,
          durationMs: 650,
          holdMs: 2400,
        },
        {
          label: 'Focus safety and data controls',
          targetX: 0.58,
          targetY: 0.42,
          zoomLevel: 1.16,
          fromMs: 21_200,
          durationMs: 650,
          holdMs: 2200,
        },
        {
          label: 'Release to full Settings surface',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 25_200,
          durationMs: 650,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1600, 5200, 9800, 14_800, 20_800, 26_000],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 5_000_000,
      maxDurationMs: 28_000,
    },
  },
  {
    id: 'agent-system.plan-review',
    kind: 'video',
    page: 'agent-system',
    slot: 'plan-review',
    title: 'Review an agent plan',
    intent:
      'Demonstrate reading an agent task thread, inspecting progress, and reviewing execution context.',
    route: '/task/docs-task-triage',
    seed: 'docs.streaming',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of reviewing an agent plan and progress inside a task thread.',
    caption:
      'Agent work stays reviewable from the task thread while execution details remain close at hand.',
    transcript:
      'The demo opens a running task thread, pauses on the plan and tool activity, scrolls through the execution context, and returns to the main progress view.',
    localized: {
      alt: allLocales(
        'Short demo of reviewing an agent plan and progress inside a task thread.',
      ),
      caption: demoCopy(
        'Agent work stays reviewable from the task thread while execution details remain close at hand.',
        '代理工作可在任务线程中审阅，执行细节始终触手可及。',
        'El trabajo del agente se puede revisar desde el hilo de tarea con los detalles de ejecución cerca.',
        "Le travail de l'agent reste révisable dans le fil de tâche, avec les détails d'exécution à portée de main.",
        'एजेंट का काम कार्य थ्रेड में समीक्षा योग्य रहता है और निष्पादन विवरण पास ही रहते हैं।',
        'O trabalho do agente permanece revisável no thread da tarefa, com detalhes de execução por perto.',
      ),
      transcript: demoCopy(
        'The demo opens a running task thread, pauses on the plan and tool activity, scrolls through the execution context, and returns to the main progress view.',
        '演示打开正在运行的任务线程，停留在计划和工具活动上，滚动查看执行上下文，然后回到主要进度视图。',
        'La demostración abre un hilo en ejecución, muestra el plan y la actividad de herramientas, recorre el contexto y vuelve al progreso principal.',
        "La démo ouvre un fil de tâche en cours, montre le plan et l'activité des outils, parcourt le contexte puis revient à la vue de progression.",
        'डेमो चालू कार्य थ्रेड खोलता है, योजना और टूल गतिविधि दिखाता है, संदर्भ में स्क्रॉल करता है और मुख्य प्रगति दृश्य पर लौटता है।',
        'A demonstração abre uma tarefa em execução, mostra o plano e as ferramentas, percorre o contexto e volta à visão de progresso.',
      ),
    },
    waitFor: '[data-testid="task-detail-page"]',
    steps: [
      {
        label: 'Pause on the task thread',
        action: 'wait',
        ms: 1600,
      },
      {
        label: 'Inspect execution context',
        action: 'scroll',
        ms: 760,
      },
      {
        label: 'Hold on progress details',
        action: 'wait',
        ms: 2600,
      },
    ],
    poster: {
      atMs: 1800,
    },
    camera: {
      fps: 30,
      durationMs: 16_000,
      zooms: [
        {
          label: 'Establish the task thread',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 600,
        },
        {
          label: 'Focus the agent response',
          targetX: 0.42,
          targetY: 0.34,
          zoomLevel: 1.18,
          fromMs: 2200,
          durationMs: 650,
          holdMs: 2200,
        },
        {
          label: 'Focus execution details',
          targetX: 0.72,
          targetY: 0.36,
          zoomLevel: 1.18,
          fromMs: 7600,
          durationMs: 650,
          holdMs: 2100,
        },
        {
          label: 'Release to full thread',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 13_100,
          durationMs: 600,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1800, 5200, 8400, 12_400, 15_400],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_600_000,
      maxDurationMs: 16_500,
    },
  },
  {
    id: 'design-mode.create-export',
    kind: 'video',
    page: 'design-mode',
    slot: 'create-export',
    title: 'Create a DesignMode project',
    intent:
      'Demonstrate selecting a design surface, filling the local project brief, and opening the generated project.',
    route: '/design',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of creating a DesignMode project from the structured project panel.',
    caption:
      'DesignMode captures the surface, project name, brief, and reusable design system before generation starts.',
    transcript:
      'The demo opens DesignMode, selects the prototype surface, enters a project name and brief, starts the project, and lands on the project workspace.',
    localized: {
      alt: allLocales(
        'Short demo of creating a DesignMode project from the structured project panel.',
      ),
      caption: demoCopy(
        'DesignMode captures the surface, project name, brief, and reusable design system before generation starts.',
        'DesignMode 会在生成开始前收集界面类型、项目名称、简报和可复用设计系统。',
        'DesignMode captura la superficie, el nombre, el brief y el sistema de diseño antes de generar.',
        'DesignMode capture la surface, le nom, le brief et le design system avant la génération.',
        'DesignMode जनरेशन से पहले सतह, परियोजना नाम, ब्रीफ और पुन: उपयोग योग्य डिज़ाइन सिस्टम लेता है।',
        'O DesignMode captura superfície, nome, briefing e design system antes da geração.',
      ),
      transcript: demoCopy(
        'The demo opens DesignMode, selects the prototype surface, enters a project name and brief, starts the project, and lands on the project workspace.',
        '演示打开 DesignMode，选择原型界面，输入项目名称和简报，启动项目并进入项目工作区。',
        'La demostración abre DesignMode, elige prototipo, escribe nombre y brief, crea el proyecto y abre su espacio de trabajo.',
        'La démo ouvre DesignMode, choisit prototype, saisit un nom et un brief, crée le projet puis ouvre son espace de travail.',
        'डेमो DesignMode खोलता है, प्रोटोटाइप सतह चुनता है, नाम और ब्रीफ दर्ज करता है, फिर प्रोजेक्ट कार्यक्षेत्र खोलता है।',
        'A demonstração abre o DesignMode, escolhe protótipo, informa nome e briefing, cria o projeto e abre o workspace.',
      ),
    },
    waitFor: '[data-testid="design-entry-view"]',
    steps: [
      {
        label: 'Open the surface picker',
        action: 'click',
        selector: '[data-testid="design-surface-picker"]',
      },
      {
        label: 'Select prototype surface',
        action: 'click',
        selector: '[data-testid="design-surface-prototype"]',
      },
      {
        label: 'Pause on prototype controls',
        action: 'wait',
        ms: 800,
      },
      {
        label: 'Name the project',
        action: 'type',
        selector: '[data-testid="design-project-name-input"]',
        value: 'Support dashboard mockup',
        typeDelay: 45,
      },
      {
        label: 'Pause on project name',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Write the design brief',
        action: 'type',
        selector: '[data-testid="design-project-brief-input"]',
        value: 'Create a compact support operations dashboard.',
        typeDelay: 35,
      },
      {
        label: 'Pause on completed brief',
        action: 'wait',
        ms: 900,
      },
      {
        label: 'Create the DesignMode project',
        action: 'click',
        selector: '[data-testid="design-create-project-button"]',
      },
      {
        label: 'Hold on generated project workspace',
        action: 'wait',
        ms: 2600,
      },
    ],
    poster: {
      atMs: 2600,
    },
    camera: {
      fps: 30,
      durationMs: 18_500,
      zooms: [
        {
          label: 'Establish DesignMode',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 600,
        },
        {
          label: 'Focus project setup',
          targetX: 0.24,
          targetY: 0.43,
          zoomLevel: 1.28,
          fromMs: 2000,
          durationMs: 700,
          holdMs: 4200,
        },
        {
          label: 'Focus create action',
          targetX: 0.24,
          targetY: 0.73,
          zoomLevel: 1.34,
          fromMs: 10_200,
          durationMs: 650,
          holdMs: 1800,
        },
        {
          label: 'Release to workspace',
          targetX: 0.55,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 15_400,
          durationMs: 650,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1800, 5200, 9800, 14_200, 18_000],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_700_000,
      maxDurationMs: 19_000,
    },
  },
  {
    id: 'media-generation.generate-asset',
    kind: 'video',
    page: 'media-generation',
    slot: 'generate-asset',
    title: 'Start a media generation project',
    intent:
      'Demonstrate switching to the image surface, choosing a prompt template context, and starting media generation.',
    route: '/design',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of creating an image generation project in DesignMode.',
    caption:
      'Media generation starts from the same structured project panel, with image-specific model and aspect controls.',
    transcript:
      'The demo opens DesignMode, switches to the image surface, names a product launch image project, enters the brief, and creates the media project.',
    localized: {
      alt: allLocales(
        'Short demo of creating an image generation project in DesignMode.',
      ),
      caption: demoCopy(
        'Media generation starts from the same structured project panel, with image-specific model and aspect controls.',
        '媒体生成从同一个结构化项目面板开始，并提供图像模型和比例控件。',
        'La generación de medios empieza en el mismo panel estructurado, con controles de modelo y relación de aspecto.',
        'La génération média démarre dans le même panneau structuré, avec des contrôles de modèle et de format.',
        'मीडिया जनरेशन उसी संरचित पैनल से शुरू होता है, जिसमें इमेज मॉडल और अनुपात नियंत्रण होते हैं।',
        'A geração de mídia começa no mesmo painel estruturado, com controles de modelo e proporção.',
      ),
      transcript: demoCopy(
        'The demo opens DesignMode, switches to the image surface, names a product launch image project, enters the brief, and creates the media project.',
        '演示打开 DesignMode，切换到图像界面，为产品发布图像项目命名，输入简报并创建媒体项目。',
        'La demostración abre DesignMode, cambia a imagen, nombra un proyecto de lanzamiento, escribe el brief y crea el proyecto.',
        'La démo ouvre DesignMode, passe à image, nomme un projet de lancement produit, saisit le brief puis crée le projet.',
        'डेमो DesignMode खोलता है, इमेज सतह चुनता है, प्रोडक्ट लॉन्च प्रोजेक्ट को नाम देता है, ब्रीफ लिखता है और प्रोजेक्ट बनाता है।',
        'A demonstração abre o DesignMode, muda para imagem, nomeia um projeto de lançamento, informa o briefing e cria o projeto.',
      ),
    },
    waitFor: '[data-testid="design-entry-view"]',
    steps: [
      {
        label: 'Open the surface picker',
        action: 'click',
        selector: '[data-testid="design-surface-picker"]',
      },
      {
        label: 'Switch to image generation',
        action: 'click',
        selector: '[data-testid="design-surface-image"]',
      },
      {
        label: 'Pause on image generation controls',
        action: 'wait',
        ms: 800,
      },
      {
        label: 'Name the media project',
        action: 'type',
        selector: '[data-testid="design-project-name-input"]',
        value: 'Product launch image set',
        typeDelay: 45,
      },
      {
        label: 'Pause on media project name',
        action: 'wait',
        ms: 650,
      },
      {
        label: 'Write the media brief',
        action: 'type',
        selector: '[data-testid="design-project-brief-input"]',
        value: 'Generate launch images for a new automation workflow.',
        typeDelay: 35,
      },
      {
        label: 'Pause on completed media brief',
        action: 'wait',
        ms: 900,
      },
      {
        label: 'Create the media project',
        action: 'click',
        selector: '[data-testid="design-create-project-button"]',
      },
      {
        label: 'Hold on media project state',
        action: 'wait',
        ms: 2600,
      },
    ],
    poster: {
      atMs: 2600,
    },
    camera: {
      fps: 30,
      durationMs: 18_500,
      zooms: [
        {
          label: 'Establish DesignMode',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 600,
        },
        {
          label: 'Focus image surface controls',
          targetX: 0.24,
          targetY: 0.33,
          zoomLevel: 1.28,
          fromMs: 2000,
          durationMs: 700,
          holdMs: 4200,
        },
        {
          label: 'Focus model and brief',
          targetX: 0.24,
          targetY: 0.6,
          zoomLevel: 1.34,
          fromMs: 10_200,
          durationMs: 650,
          holdMs: 1800,
        },
        {
          label: 'Release to project result',
          targetX: 0.55,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 15_400,
          durationMs: 650,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1800, 5200, 9800, 14_200, 18_000],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_700_000,
      maxDurationMs: 19_000,
    },
  },
  {
    id: 'automations.schedule-run',
    kind: 'video',
    page: 'automations',
    slot: 'schedule-run',
    title: 'Run a scheduled automation',
    intent:
      'Demonstrate reviewing scheduled automations, running one manually, and inspecting the automation detail state.',
    route: '/automation',
    seed: 'docs.populated',
    priority: 'required',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Short demo of running a scheduled automation from the automations dashboard.',
    caption:
      'Automations can be reviewed from the dashboard and run on demand when a scheduled workflow needs a manual pass.',
    transcript:
      'The demo opens Automations, focuses a scheduled digest automation, runs it once, opens the detail view, and pauses on the run history area.',
    localized: {
      alt: allLocales(
        'Short demo of running a scheduled automation from the automations dashboard.',
      ),
      caption: demoCopy(
        'Automations can be reviewed from the dashboard and run on demand when a scheduled workflow needs a manual pass.',
        '可以在仪表板中审阅自动化，并在计划流程需要手动执行时按需运行。',
        'Las automatizaciones se revisan en el panel y pueden ejecutarse bajo demanda cuando hace falta una pasada manual.',
        'Les automatisations se consultent dans le tableau de bord et peuvent être lancées à la demande.',
        'ऑटोमेशन डैशबोर्ड से समीक्षा किए जा सकते हैं और जरूरत पड़ने पर मैन्युअल रूप से चलाए जा सकते हैं।',
        'As automações podem ser revisadas no painel e executadas sob demanda quando necessário.',
      ),
      transcript: demoCopy(
        'The demo opens Automations, focuses a scheduled digest automation, runs it once, opens the detail view, and pauses on the run history area.',
        '演示打开自动化页面，聚焦计划摘要自动化，运行一次，打开详情视图，并停留在运行历史区域。',
        'La demostración abre Automatizaciones, enfoca un digest programado, lo ejecuta una vez, abre el detalle y muestra el historial.',
        "La démo ouvre Automatisations, cible un digest planifié, l'exécute une fois, ouvre le détail puis affiche l'historique.",
        'डेमो ऑटोमेशन खोलता है, निर्धारित डाइजेस्ट पर फोकस करता है, उसे एक बार चलाता है, विवरण खोलता है और रन हिस्ट्री दिखाता है।',
        'A demonstração abre Automações, foca um digest agendado, executa uma vez, abre os detalhes e mostra o histórico.',
      ),
    },
    waitFor: '[data-testid="automation-page"]',
    steps: [
      {
        label: 'Pause on automation dashboard',
        action: 'wait',
        ms: 1400,
      },
      {
        label: 'Run the scheduled digest once',
        action: 'click',
        selector: '[data-testid="automation-run-docs-automation-digest"]',
      },
      {
        label: 'Pause on manual run feedback',
        action: 'wait',
        ms: 1100,
      },
      {
        label: 'Open the scheduled automation',
        action: 'click',
        selector: '[data-testid="automation-card-docs-automation-digest"]',
      },
      {
        label: 'Hold on automation detail',
        action: 'wait',
        ms: 2600,
      },
    ],
    poster: {
      atMs: 2400,
    },
    camera: {
      fps: 30,
      durationMs: 15_500,
      zooms: [
        {
          label: 'Establish automations dashboard',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 600,
        },
        {
          label: 'Focus scheduled automation',
          targetX: 0.38,
          targetY: 0.4,
          zoomLevel: 1.24,
          fromMs: 1900,
          durationMs: 650,
          holdMs: 1900,
        },
        {
          label: 'Focus run action',
          targetX: 0.49,
          targetY: 0.35,
          zoomLevel: 1.34,
          fromMs: 6000,
          durationMs: 650,
          holdMs: 1600,
        },
        {
          label: 'Release to automation detail',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 12_200,
          durationMs: 650,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1600, 4800, 7200, 11_200, 15_000],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_500_000,
      maxDurationMs: 16_000,
    },
  },
  {
    id: 'projects.list',
    kind: 'image',
    page: 'projects',
    slot: 'list',
    title: 'Projects list',
    intent:
      'Show how active projects group ongoing work with workspace-aware context.',
    route: '/projects',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Projects page showing active project cards with descriptions.',
    caption:
      'Projects keep related tasks and workspace context organized in one place.',
    privacyMasks: [
      {
        selector: '[data-testid="project-workspace"]',
        replacement: '~/work/acme-support',
      },
    ],
    waitFor: '[data-testid="project-list"]',
    budgets: {
      maxBytes: 320_000,
    },
  },
  {
    id: 'projects.detail',
    kind: 'image',
    page: 'projects',
    slot: 'detail',
    title: 'Project detail',
    intent:
      'Show the scoped task list and workspace context available inside a project.',
    route: '/projects/docs-project-alpha',
    seed: 'docs.populated',
    surfaces: ['docs'],
    owner: 'Docs',
    alt: 'Project detail page showing workspace context and assigned tasks.',
    caption:
      'A project detail page keeps task history, workspace, and new task entry points together.',
    privacyMasks: [
      {
        selector: '[data-testid="project-workspace"]',
        replacement: '~/work/acme-support',
      },
    ],
    waitFor: '[data-testid="project-detail"]',
    budgets: {
      maxBytes: 360_000,
    },
  },
  {
    id: 'projects.create',
    kind: 'video',
    page: 'projects',
    slot: 'create',
    title: 'Create a scoped project task',
    intent:
      'Demonstrate creating a project and starting a task that inherits project context.',
    route: '/projects',
    seed: 'docs.populated',
    surfaces: ['docs', 'landing'],
    owner: 'Docs',
    alt: 'Short demo of creating a project and starting a scoped task.',
    caption:
      'Create a project, open it, and start a new task with the project workspace attached.',
    transcript:
      'The demo opens Projects, creates a project, opens the project detail page, and starts a new task scoped to that project.',
    localized: {
      alt: allLocales(
        'Short demo of creating a project and starting a scoped task.',
      ),
      caption: demoCopy(
        'Create a project, open it, and start a new task with the project workspace attached.',
        '创建项目、打开项目，并在附加项目工作区的情况下启动新任务。',
        'Crea un proyecto, ábrelo e inicia una nueva tarea con el espacio de trabajo adjunto.',
        'Créez un projet, ouvrez-le, puis démarrez une tâche avec le workspace du projet attaché.',
        'एक प्रोजेक्ट बनाएं, उसे खोलें और परियोजना कार्यक्षेत्र के साथ नया कार्य शुरू करें।',
        'Crie um projeto, abra-o e inicie uma nova tarefa com o workspace anexado.',
      ),
      transcript: demoCopy(
        'The demo opens Projects, creates a project, opens the project detail page, and starts a new task scoped to that project.',
        '演示打开项目页，创建项目，进入项目详情页，并启动一个限定在该项目中的新任务。',
        'La demostración abre Proyectos, crea un proyecto, abre sus detalles e inicia una tarea dentro de ese proyecto.',
        'La démo ouvre Projets, crée un projet, ouvre son détail et démarre une tâche limitée à ce projet.',
        'डेमो प्रोजेक्ट्स खोलता है, प्रोजेक्ट बनाता है, विवरण पेज खोलता है और उसी प्रोजेक्ट में नया कार्य शुरू करता है।',
        'A demonstração abre Projetos, cria um projeto, abre os detalhes e inicia uma tarefa vinculada a ele.',
      ),
    },
    privacyMasks: [
      {
        selector: '[data-testid="project-workspace"]',
        replacement: '~/work/acme-support',
      },
    ],
    waitFor: '[data-testid="projects-page"]',
    steps: [
      {
        label: 'Open the new project form',
        action: 'click',
        selector: '[data-testid="project-create-toggle"]',
      },
      {
        label: 'Pause on project form',
        action: 'wait',
        ms: 1100,
      },
      {
        label: 'Enter the project name',
        action: 'type',
        selector: '[data-testid="project-name-input"]',
        value: 'Acme support workspace',
        typeDelay: 45,
      },
      {
        label: 'Pause on project name',
        action: 'wait',
        ms: 700,
      },
      {
        label: 'Enter the project description',
        action: 'type',
        selector: '[data-testid="project-description-input"]',
        value: 'Customer support automation and reporting tasks',
        typeDelay: 35,
      },
      {
        label: 'Pause on project description',
        action: 'wait',
        ms: 700,
      },
      {
        label: 'Enter the workspace path',
        action: 'type',
        selector: '[data-testid="project-workspace-input"]',
        value: '~/work/acme-support',
        typeDelay: 45,
      },
      {
        label: 'Pause on workspace scope',
        action: 'wait',
        ms: 900,
      },
      {
        label: 'Create the project',
        action: 'click',
        selector: '[data-testid="project-submit-button"]',
      },
      {
        label: 'Pause on created project card',
        action: 'wait',
        ms: 1400,
      },
      {
        label: 'Open the project detail',
        action: 'click',
        selector: '[data-testid="project-card-docs-project-alpha"]',
      },
      {
        label: 'Pause on project detail',
        action: 'wait',
        ms: 1400,
      },
      {
        label: 'Start a scoped task',
        action: 'click',
        selector: '[data-testid="project-new-task-button"]',
      },
      {
        label: 'Pause on the scoped task composer',
        action: 'wait',
        ms: 1800,
      },
    ],
    poster: {
      atMs: 1600,
    },
    camera: {
      fps: 30,
      durationMs: 21_000,
      zooms: [
        {
          label: 'Establish the projects list',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 0,
          durationMs: 500,
          holdMs: 600,
        },
        {
          label: 'Focus the create project form',
          targetX: 0.52,
          targetY: 0.36,
          zoomLevel: 1.18,
          fromMs: 1800,
          durationMs: 600,
          holdMs: 5600,
        },
        {
          label: 'Focus the new task affordance',
          targetX: 0.78,
          targetY: 0.28,
          zoomLevel: 1.2,
          fromMs: 14_600,
          durationMs: 600,
          holdMs: 1600,
        },
        {
          label: 'Release to the scoped task composer',
          targetX: 0.5,
          targetY: 0.5,
          zoomLevel: 1,
          fromMs: 18_000,
          durationMs: 600,
        },
      ],
    },
    effects: ['zoom-pan'],
    renderer: {
      primary: 'hyperframes',
      compare: true,
      hyperframes: {
        generatedProject: true,
        snapshotAtMs: [1600, 6800, 12_800, 16_200, 20_200],
        docker: true,
      },
    },
    budgets: {
      maxBytes: 2_500_000,
      maxDurationMs: 21_500,
    },
  },
];
