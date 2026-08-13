import { chromium } from 'playwright';
import type { Page, Route } from 'playwright';

import {
  getDocMediaEntries,
  parseDocsMediaCliArgs,
  RAW_DOCS_DIR,
  rawEntryDir,
} from './lib/docs-media-config';
import {
  applyPrivacyMasks,
  executeStep,
  installDeterministicBrowserState,
  preparePageForCapture,
} from './lib/playwright-capture';

import fs from 'fs/promises';
import path from 'path';

const DEFAULT_APP_URL = 'http://localhost:3420';
const APP_SLUG = 'neumar';
const DOCS_CAPTURE_TIME = '2026-05-04T12:00:00.000Z';
const DOCS_WORKSPACE = '~/work/acme-support';
const DOCS_PROJECT_ID = 'docs-project-alpha';
const DOCS_TASK_ID = 'docs-task-triage';
const DOCS_SESSION_ID = '20260504120000_docs_media';
const DOCS_PROFILE_ID = 'docs-profile-product';
const VIDEO_CAPTURE_DEVICE_SCALE_FACTOR = 1;
const VIDEO_CAPTURE_PRE_ROLL_MS = 2600;
const DEFAULT_POST_STEP_VIDEO_HOLD_MS = 1000;
const VIDEO_CAPTURE_TAIL_MS = 500;

const demoSession = {
  id: DOCS_SESSION_ID,
  prompt:
    'Audit inbound support tickets and draft a prioritized triage plan for the Acme support workspace.',
  task_count: 2,
  created_at: DOCS_CAPTURE_TIME,
  updated_at: DOCS_CAPTURE_TIME,
};

const demoProject = {
  id: DOCS_PROJECT_ID,
  name: 'Acme support workspace',
  description: 'Customer support automation and reporting tasks',
  color: '#6366f1',
  work_dir: DOCS_WORKSPACE,
  workspace: DOCS_WORKSPACE,
  status: 'active',
  task_counts: {
    running: 1,
    completed: 1,
    error: 0,
    stopped: 0,
  },
  created_at: DOCS_CAPTURE_TIME,
  updated_at: DOCS_CAPTURE_TIME,
};

const demoTasks = [
  {
    id: DOCS_TASK_ID,
    session_id: DOCS_SESSION_ID,
    task_index: 1,
    prompt:
      'Audit inbound support tickets and draft a prioritized triage plan for the Acme support workspace.',
    title: 'Triage support backlog',
    work_dir: DOCS_WORKSPACE,
    additional_work_dirs: null,
    status: 'running',
    priority: 'high',
    cost: 1.42,
    duration: null,
    favorite: true,
    assignee_profile_id: DOCS_PROFILE_ID,
    project_id: DOCS_PROJECT_ID,
    created_at: DOCS_CAPTURE_TIME,
    updated_at: DOCS_CAPTURE_TIME,
  },
  {
    id: 'docs-task-reporting',
    session_id: DOCS_SESSION_ID,
    task_index: 2,
    prompt: 'Prepare a weekly product feedback summary for leadership.',
    title: 'Summarize product feedback',
    work_dir: DOCS_WORKSPACE,
    additional_work_dirs: null,
    status: 'completed',
    priority: 'medium',
    cost: 2.18,
    duration: 184_000,
    favorite: false,
    assignee_profile_id: DOCS_PROFILE_ID,
    project_id: DOCS_PROJECT_ID,
    created_at: '2026-05-04T11:30:00.000Z',
    updated_at: DOCS_CAPTURE_TIME,
  },
  {
    id: 'docs-task-unassigned',
    session_id: '20260504103000_docs_research',
    task_index: 1,
    prompt: 'Find launch blockers in the docs backlog.',
    title: 'Review docs launch blockers',
    work_dir: DOCS_WORKSPACE,
    additional_work_dirs: null,
    status: 'stopped',
    priority: 'low',
    cost: 0.76,
    duration: 92_000,
    favorite: false,
    assignee_profile_id: null,
    project_id: null,
    created_at: '2026-05-04T10:30:00.000Z',
    updated_at: '2026-05-04T10:45:00.000Z',
  },
];

const demoMessages = [
  {
    id: 1,
    task_id: DOCS_TASK_ID,
    type: 'user',
    content:
      'Audit inbound support tickets and draft a prioritized triage plan.',
    tool_name: null,
    tool_input: null,
    tool_output: null,
    tool_use_id: null,
    subtype: null,
    error_message: null,
    attachments: null,
    message_id: 'docs-msg-user',
    cost: null,
    usage_input: null,
    usage_output: null,
    usage_cache_read: null,
    usage_cache_creation: null,
    model: null,
    created_at: DOCS_CAPTURE_TIME,
  },
  {
    id: 2,
    task_id: DOCS_TASK_ID,
    type: 'text',
    content:
      'I am grouping the backlog by severity, customer tier, and requested follow-up date.',
    tool_name: null,
    tool_input: null,
    tool_output: null,
    tool_use_id: null,
    subtype: null,
    error_message: null,
    attachments: null,
    message_id: 'docs-msg-assistant',
    cost: 0.18,
    usage_input: 4300,
    usage_output: 680,
    usage_cache_read: 0,
    usage_cache_creation: 0,
    model: 'claude-sonnet-4-5',
    created_at: DOCS_CAPTURE_TIME,
  },
];

let createdDemoTask: ({ id: string } & Record<string, unknown>) | null = null;
let createdDemoMessages: Record<string, unknown>[] | null = null;

function resetMutableCaptureState() {
  createdDemoTask = null;
  createdDemoMessages = null;
}

const demoFiles = [
  {
    id: 1,
    task_id: DOCS_TASK_ID,
    name: 'support-triage-plan.md',
    type: 'text',
    path: `${DOCS_WORKSPACE}/support-triage-plan.md`,
    preview:
      '# Support triage plan\n\n- Prioritize enterprise escalation follow-ups\n- Draft customer-safe status updates\n- Create Linear issues for blocked renewals',
    thumbnail: null,
    is_favorite: true,
    created_at: DOCS_CAPTURE_TIME,
  },
  {
    id: 2,
    task_id: DOCS_TASK_ID,
    name: 'support-dashboard.png',
    type: 'image',
    path: `${DOCS_WORKSPACE}/support-dashboard.png`,
    preview: null,
    thumbnail: null,
    is_favorite: false,
    created_at: DOCS_CAPTURE_TIME,
  },
];

const demoMediaVersions = [
  {
    id: 'docs-media-version-dashboard-v1',
    task_id: DOCS_TASK_ID,
    artifact_id: 'artifact-support-dashboard',
    version_number: 1,
    path: `${DOCS_WORKSPACE}/support-dashboard.png`,
    prompt: 'Create a compact support operations dashboard preview.',
    previous_version_id: null,
    type: 'image',
    created_at: DOCS_CAPTURE_TIME,
  },
];

const demoAgentProfiles = [
  {
    id: DOCS_PROFILE_ID,
    name: 'Product Ops Agent',
    role: 'Product operations',
    description: 'Turns workspace context into structured operating plans.',
    avatar_color: '#6366f1',
    avatar_icon: 'sparkles',
    runtime_id: 'claude',
    default_model: 'claude-sonnet-4-5',
    default_mcp_servers: JSON.stringify(['linear', 'github']),
    default_skills: JSON.stringify(['docs-audit', 'release-notes']),
    system_prompt: 'Work as a concise product operations partner.',
    soul: null,
    soul_version: 1,
    soul_origin: 'predefined',
    max_concurrent_tasks: 2,
    default_thinking_config: null,
    routing_hints: null,
    status: 'active',
    task_count: 2,
    created_at: DOCS_CAPTURE_TIME,
    updated_at: DOCS_CAPTURE_TIME,
  },
];

const demoAutomations = [
  {
    id: 'docs-automation-digest',
    name: 'Daily support digest',
    description: 'Summarizes new support threads and flags urgent follow-ups.',
    enabled: true,
    prompt: 'Summarize priority support work and create follow-up tasks.',
    trigger: {
      type: 'cron',
      schedule: {
        kind: 'cron',
        cronExpr: '0 9 * * 1-5',
        timezone: 'America/Toronto',
      },
    },
    agent: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      usePlanning: true,
      autoApprove: false,
      workDir: DOCS_WORKSPACE,
      timeoutMs: 900_000,
      mcpServers: ['linear'],
      skills: ['support-triage'],
    },
    delivery: { mode: 'desktop' },
    tags: ['support', 'daily'],
    createdAt: DOCS_CAPTURE_TIME,
    updatedAt: DOCS_CAPTURE_TIME,
    runCount: 18,
    totalCost: 5.84,
    origin: 'ui',
    locale: 'en',
    overlapPolicy: 'skip',
    missedFirePolicy: 'fire_once',
    nextRunAt: '2026-05-05T13:00:00.000Z',
  },
  {
    id: 'docs-automation-renewal',
    name: 'Renewal-risk webhook',
    description: 'Runs a readiness check when account health changes.',
    enabled: true,
    prompt: 'Inspect the renewal risk payload and draft a mitigation plan.',
    trigger: {
      type: 'webhook',
      webhook: {
        slug: 'renewal-risk',
        token: 'docs-token',
        maxBodyBytes: 65536,
      },
    },
    agent: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      usePlanning: true,
      autoApprove: false,
      workDir: DOCS_WORKSPACE,
      timeoutMs: 900_000,
      mcpServers: ['linear', 'slack'],
      skills: ['account-brief'],
    },
    delivery: { mode: 'desktop' },
    tags: ['account'],
    createdAt: DOCS_CAPTURE_TIME,
    updatedAt: DOCS_CAPTURE_TIME,
    runCount: 7,
    totalCost: 3.21,
    origin: 'api',
    locale: 'en',
    overlapPolicy: 'queue',
    missedFirePolicy: 'fire_immediately',
  },
  {
    id: 'docs-automation-queue',
    name: 'Queue pickup heartbeat',
    description: 'Checks the triage queue and starts work when capacity opens.',
    enabled: false,
    prompt: 'Pick up the next ready ticket from the support queue.',
    trigger: {
      type: 'heartbeat',
      heartbeat: {
        intervalMs: 900_000,
        activeHours: '09:00-17:00',
        timezone: 'America/Toronto',
        mode: 'queue_pickup',
      },
    },
    agent: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      usePlanning: true,
      autoApprove: false,
      workDir: DOCS_WORKSPACE,
      timeoutMs: 900_000,
      mcpServers: ['linear'],
      skills: ['queue-pickup'],
    },
    delivery: { mode: 'desktop' },
    tags: ['queue'],
    createdAt: DOCS_CAPTURE_TIME,
    updatedAt: DOCS_CAPTURE_TIME,
    runCount: 4,
    totalCost: 1.09,
    origin: 'ui',
    locale: 'en',
    overlapPolicy: 'skip',
    missedFirePolicy: 'skip',
  },
];

const demoDesignSystems = [
  {
    id: 'docs-system-saas',
    title: 'Operational SaaS',
    category: 'Product',
    summary: 'Dense, quiet interfaces for repeated work.',
    body: 'Use compact tables, restrained surfaces, and clear hierarchy.',
    swatches: ['#111827', '#6366f1', '#14b8a6', '#f8fafc'],
    tokens: ['radius-sm', 'spacing-4', 'surface-card'],
  },
];

const demoDesignSkills = [
  {
    id: 'docs-skill-dashboard',
    name: 'Dashboard polish',
    slug: 'dashboard-polish',
    description:
      'Create focused operational dashboards with scan-friendly rows.',
    source: 'bundled',
    path: 'skills/dashboard-polish',
    icon: 'layout-dashboard',
    category: 'prototype',
    trigger: 'dashboard',
    od: {
      mode: 'design',
      platform: 'desktop',
      featured: 1,
      surface: 'prototype',
      scenario: 'SaaS dashboard',
      examplePrompt:
        'Design a compact operations dashboard for support managers.',
      craft: { requires: [] },
      capabilitiesRequired: [],
      warnings: [],
    },
  },
  {
    id: 'docs-skill-image',
    name: 'Product hero image',
    slug: 'product-hero-image',
    description: 'Generate inspectable product-focused image concepts.',
    source: 'bundled',
    path: 'skills/product-hero-image',
    icon: 'image',
    category: 'image',
    trigger: 'image',
    od: {
      mode: 'design',
      platform: 'desktop',
      featured: 2,
      surface: 'image',
      scenario: 'Marketing image',
      examplePrompt: 'Create a crisp product hero image with real UI context.',
      craft: { requires: [] },
      capabilitiesRequired: [],
      warnings: [],
    },
  },
];

const demoPromptTemplates = [
  {
    id: 'docs-template-product-image',
    surface: 'image',
    title: 'Product feature image',
    description: 'A clean product image for docs and launch pages.',
    prompt: 'Create a product-focused visual with clear UI details.',
    model: 'gpt-image-1',
    aspect: '16:9',
    previewImageUrl: '',
  },
  {
    id: 'docs-template-demo-video',
    surface: 'video',
    title: 'Feature demo cutdown',
    description: 'A short demo video that shows a workflow from start to end.',
    prompt: 'Create a concise feature demo with readable interface states.',
    model: 'sora-2-pro',
    aspect: '16:9',
    durationSeconds: 8,
    previewVideoUrl: '',
  },
];

const demoDesignProjects = [
  {
    id: 'docs-design-dashboard',
    title: 'Support dashboard mockup',
    surface: 'prototype',
    status: 'ready',
    skillId: 'docs-skill-dashboard',
    designSystemId: 'docs-system-saas',
    inspirationDesignSystemIds: [],
    craftRefs: [],
    brief: {
      prompt: 'Create a compact support operations dashboard.',
    },
    outputs: [],
    createdAt: DOCS_CAPTURE_TIME,
    updatedAt: DOCS_CAPTURE_TIME,
  },
  {
    id: 'docs-design-image',
    title: 'Product launch image set',
    surface: 'image',
    status: 'ready',
    skillId: 'docs-skill-image',
    designSystemId: 'docs-system-saas',
    inspirationDesignSystemIds: [],
    craftRefs: [],
    brief: {
      prompt: 'Generate launch images for a new automation workflow.',
    },
    media: {
      model: 'gpt-image-1',
      aspect: '16:9',
      imageStyle: 'product',
    },
    outputs: [],
    createdAt: '2026-05-04T11:45:00.000Z',
    updatedAt: DOCS_CAPTURE_TIME,
  },
];

const demoDesignBudget = {
  allowed: true,
  severity: 'none',
  config: {
    maxImageGenerations: 12,
    maxVideoJobs: 4,
    maxVideoSeconds: 60,
    maxAudioSeconds: 120,
    maxRetryCount: 2,
    maxStorageBytes: 50_000_000,
    strictProviderMode: false,
  },
  used: {
    imageGenerations: 2,
    videoJobs: 0,
    videoSeconds: 0,
    audioSeconds: 0,
    storageBytes: 240_000,
  },
  requested: {},
  remaining: {
    imageGenerations: 10,
    videoJobs: 4,
    videoSeconds: 60,
    audioSeconds: 120,
    storageBytes: 49_760_000,
  },
};

const demoPlugins = [
  {
    name: 'github',
    version: '1.0.0',
    description: 'Repository, issue, and pull request automation tools.',
    scope: 'marketplace',
    path: 'marketplace://github',
    skillCount: 4,
    skills: [
      {
        name: 'github:triage',
        bareName: 'triage',
        path: 'marketplace://github/skills/triage',
      },
    ],
  },
  {
    name: 'linear',
    version: '1.0.0',
    description: 'Planning workflows and issue sync for Linear teams.',
    scope: 'marketplace',
    path: 'marketplace://linear',
    skillCount: 3,
    skills: [
      {
        name: 'linear:plan',
        bareName: 'plan',
        path: 'marketplace://linear/skills/plan',
      },
    ],
  },
  {
    name: 'docs-media',
    version: '0.1.0',
    description: 'Capture and verify screenshots and demos for documentation.',
    scope: 'marketplace',
    path: 'marketplace://docs-media',
    skillCount: 2,
    skills: [
      {
        name: 'docs-media:capture',
        bareName: 'capture',
        path: 'marketplace://docs-media/skills/capture',
      },
    ],
  },
];

const demoCloudConnections = [
  {
    id: 'docs-immich-library',
    provider: 'immich',
    displayName: 'Product media library',
    status: 'connected',
    capabilities: {
      preferredView: 'media-grid',
      readOnly: false,
      mediaMetadata: {
        writableFields: ['description', 'isFavorite', 'rating', 'tags'],
      },
    },
  },
];

const demoCloudAssets = [
  {
    id: 'docs-asset-hero',
    provider: 'immich',
    name: 'launch-automation-hero.png',
    mimeType: 'image/png',
    size: 384_000,
    createdAt: DOCS_CAPTURE_TIME,
    thumbnailUrl: '',
    mediaMetadata: {
      isFavorite: true,
      fileInfo: {
        width: 1920,
        height: 1080,
      },
    },
  },
  {
    id: 'docs-asset-demo',
    provider: 'immich',
    name: 'support-dashboard-demo.mp4',
    mimeType: 'video/mp4',
    size: 1_280_000,
    createdAt: '2026-05-04T11:40:00.000Z',
    thumbnailUrl: '',
    mediaMetadata: {
      fileInfo: {
        width: 1920,
        height: 1080,
        durationSeconds: 14,
      },
    },
  },
];

const demoApprovals = [
  {
    id: 'docs-approval-plan',
    approval_type: 'plan',
    status: 'pending',
    title: 'Review support triage execution plan',
    description:
      'Agent requests approval before updating customer-facing triage files.',
    payload: JSON.stringify({
      goal: 'Audit inbound support tickets and draft the triage update.',
      steps: [
        'Read the current support backlog',
        'Group tickets by urgency and owner',
        'Draft a prioritized handoff plan',
      ],
    }),
    entity_type: 'task',
    entity_id: DOCS_TASK_ID,
    expires_at: '2026-05-04T12:10:00.000Z',
    created_at: DOCS_CAPTURE_TIME,
    risk_level: 'medium',
  },
];

interface CaptureMetadata {
  id: string;
  kind: 'image' | 'video';
  page: string;
  slot: string;
  route: string;
  seed: string;
  viewport: { width: number; height: number };
  captureProfile: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    colorScheme: 'dark' | 'light' | 'no-preference';
    reducedMotion: 'reduce' | 'no-preference';
    forcedColors: 'active' | 'none';
    recordVideo: {
      size: { width: number; height: number };
    };
  };
  theme: string;
  selectors: {
    waitFor?: string;
    masks: string[];
    steps: string[];
  };
  capturedAt: string;
  source: string;
}

function getArgValue(name: string) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

async function writeCaptureMetadata(dir: string, metadata: CaptureMetadata) {
  await fs.writeFile(
    path.join(dir, 'capture.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

function text(body: string, contentType = 'text/plain') {
  return {
    status: 200,
    contentType,
    body,
  };
}

const DEMO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function requestJson<T extends object>(route: Route): Partial<T> {
  try {
    return route.request().postDataJSON() as Partial<T>;
  } catch {
    return {};
  }
}

async function binaryFileFixture(filePath: string | undefined) {
  const fileName = filePath ? path.basename(filePath) : 'docs-file.md';
  if (fileName.match(/\.(avif|gif|jpe?g|png|webp)$/i)) {
    try {
      const demoImage = await fs.readFile(
        path.join(RAW_DOCS_DIR, 'linear-pipeline/hero/source.png'),
      );
      return {
        fileName,
        content: demoImage.toString('base64'),
        size: demoImage.byteLength,
      };
    } catch {
      // Fall back to a tiny valid PNG if the hero image has not been captured yet.
    }
    return {
      fileName,
      content: DEMO_PNG_BASE64,
      size: Buffer.byteLength(DEMO_PNG_BASE64, 'base64'),
    };
  }

  const content = fileName.includes('x-launch')
    ? '# X launch post\n\nMeet Neumar: an agentic AI desktop workspace for planning tasks, drafting copy, generating media direction, and reviewing outputs in one flow.\n\n#AgenticAI #DesktopAI #AIWorkspace\n'
    : '# Support triage plan\n\n- Prioritize enterprise escalation follow-ups\n- Draft customer-safe status updates\n- Create Linear issues for blocked renewals\n';

  return {
    fileName,
    content: Buffer.from(content, 'utf8').toString('base64'),
    size: Buffer.byteLength(content, 'utf8'),
  };
}

function taskForPath(pathname: string) {
  const match = pathname.match(/^\/db\/tasks\/([^/]+)/);
  if (!match) return undefined;
  if (createdDemoTask?.id === match[1]) return createdDemoTask;
  return demoTasks.find((task) => task.id === match[1]);
}

function titleForPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  if (
    normalized.includes('x post') ||
    normalized.includes('social post') ||
    normalized.includes('launch image')
  ) {
    return 'Draft X launch post and image brief';
  }
  return 'Draft support triage plan';
}

function assistantPreviewForPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  if (
    normalized.includes('x post') ||
    normalized.includes('social post') ||
    normalized.includes('launch image')
  ) {
    return 'I will draft the X post, create image direction, prepare variants, and keep the final copy ready for review before publishing.';
  }
  return 'I am grouping the backlog by severity, customer tier, and requested follow-up date.';
}

function filesForTask(taskId: string) {
  if (createdDemoTask?.id === taskId) {
    return [
      {
        id: 101,
        task_id: taskId,
        name: 'x-launch-post.md',
        type: 'text',
        path: `${DOCS_WORKSPACE}/x-launch-post.md`,
        preview:
          '# X launch post\n\nMeet Neumar: an agentic AI desktop workspace for planning tasks, drafting copy, generating media direction, and reviewing outputs in one flow.\n\n#AgenticAI #DesktopAI #AIWorkspace',
        thumbnail: null,
        is_favorite: true,
        created_at: DOCS_CAPTURE_TIME,
      },
      {
        id: 102,
        task_id: taskId,
        name: 'product-image-concept.png',
        type: 'image',
        path: `${DOCS_WORKSPACE}/product-image-concept.png`,
        preview: null,
        thumbnail: null,
        is_favorite: false,
        created_at: DOCS_CAPTURE_TIME,
      },
    ];
  }
  return demoFiles;
}

function mediaVersionsForTask(taskId: string) {
  if (createdDemoTask?.id === taskId) {
    return [
      {
        id: 'docs-media-version-launch-image-v1',
        task_id: taskId,
        artifact_id: 'artifact-launch-image',
        version_number: 1,
        path: `${DOCS_WORKSPACE}/product-image-concept.png`,
        prompt:
          'Create a 16:9 product image concept showing an agentic desktop workspace with task planning, generated copy, and media outputs.',
        previous_version_id: null,
        type: 'image',
        created_at: DOCS_CAPTURE_TIME,
      },
    ];
  }
  return demoMediaVersions;
}

function costRollup(groupBy: string | null) {
  const effectiveGroupBy = groupBy ?? 'provider';
  return {
    range: '30d',
    groupBy: effectiveGroupBy,
    since: new Date('2026-04-04T12:00:00.000Z').getTime(),
    summary: {
      costUsd: 12.34,
      calls: 28,
      inputTokens: 184_000,
      outputTokens: 32_400,
      p95LatencyMs: 5400,
    },
    groups:
      effectiveGroupBy === 'model'
        ? [
            {
              key: 'claude-sonnet-4-5',
              provider: 'anthropic',
              model: 'claude-sonnet-4-5',
              costUsd: 8.18,
              calls: 19,
              inputTokens: 128_000,
              outputTokens: 22_100,
              meanLatencyMs: 3200,
              p95LatencyMs: 5100,
            },
            {
              key: 'gpt-5.4',
              provider: 'openai',
              model: 'gpt-5.4',
              costUsd: 4.16,
              calls: 9,
              inputTokens: 56_000,
              outputTokens: 10_300,
              meanLatencyMs: 4100,
              p95LatencyMs: 5400,
            },
          ]
        : [
            {
              key: 'anthropic',
              provider: 'anthropic',
              model: null,
              costUsd: 8.18,
              calls: 19,
              inputTokens: 128_000,
              outputTokens: 22_100,
              meanLatencyMs: 3200,
              p95LatencyMs: 5100,
            },
            {
              key: 'openai',
              provider: 'openai',
              model: null,
              costUsd: 4.16,
              calls: 9,
              inputTokens: 56_000,
              outputTokens: 10_300,
              meanLatencyMs: 4100,
              p95LatencyMs: 5400,
            },
          ],
    source: 'docs-fixture',
  };
}

function promptTemplatesForSurface(surface: string | null) {
  return demoPromptTemplates.filter((template) => template.surface === surface);
}

function shouldMockApi(url: URL) {
  return (
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    url.port === '5126'
  );
}

function designProjectById(projectId: string) {
  return (
    demoDesignProjects.find((project) => project.id === projectId) ??
    demoDesignProjects[0]
  );
}

function designProjectForCreate(route: Route) {
  try {
    const body = route.request().postDataJSON() as {
      surface?: string;
      title?: string;
    };
    if (
      body.surface === 'image' ||
      body.title?.toLowerCase().includes('image')
    ) {
      return demoDesignProjects[1];
    }
  } catch {
    // Fall back to the prototype project when the request body is absent.
  }
  return demoDesignProjects[0];
}

async function fulfillDocsApiMock(route: Route) {
  const request = route.request();
  const url = new URL(request.url());
  if (!shouldMockApi(url)) {
    await route.continue();
    return;
  }

  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204 });
    return;
  }

  const { pathname, searchParams } = url;

  if (pathname === '/health/dependencies') {
    await route.fulfill(json({ success: true, claudeCode: true }));
    return;
  }

  if (pathname === '/health') {
    await route.fulfill(
      json({
        status: 'ok',
        timestamp: DOCS_CAPTURE_TIME,
        uptime: 1840,
        memory: {
          rss: 286,
          heapTotal: 128,
          heapUsed: 62,
          external: 18,
          arrayBuffers: 6,
          unit: 'MB',
        },
      }),
    );
    return;
  }

  if (pathname === '/auth/status') {
    await route.fulfill(json({ authenticated: false, connections: [] }));
    return;
  }

  if (pathname === '/db/settings') {
    await route.fulfill(json({}));
    return;
  }

  if (pathname.startsWith('/db/settings/')) {
    await route.fulfill(json({ value: null }));
    return;
  }

  if (pathname === '/db/sessions') {
    if (request.method() === 'POST') {
      const input = requestJson<{ id: string; prompt: string }>(route);
      await route.fulfill(
        json({
          ...demoSession,
          id: input.id ?? demoSession.id,
          prompt: input.prompt ?? demoSession.prompt,
          task_count: 0,
        }),
      );
      return;
    }
    await route.fulfill(json([demoSession]));
    return;
  }

  if (pathname.match(/^\/db\/sessions\/[^/]+\/tasks$/)) {
    const sessionId = pathname.split('/')[3];
    if (createdDemoTask?.session_id === sessionId) {
      await route.fulfill(json([createdDemoTask]));
      return;
    }
    await route.fulfill(
      json(
        sessionId === DOCS_SESSION_ID
          ? demoTasks.filter((task) => task.session_id === DOCS_SESSION_ID)
          : [],
      ),
    );
    return;
  }

  if (pathname.match(/^\/db\/sessions\/[^/]+$/)) {
    await route.fulfill(json(demoSession));
    return;
  }

  if (pathname === '/db/tasks') {
    if (request.method() === 'POST') {
      const input = requestJson<{
        id: string;
        session_id: string;
        task_index: number;
        prompt: string;
        work_dir: string;
        additional_work_dirs: string;
        assignee_profile_id: string;
      }>(route);
      const prompt = input.prompt ?? demoTasks[0].prompt;
      createdDemoTask = {
        id: input.id ?? DOCS_TASK_ID,
        session_id: input.session_id ?? DOCS_SESSION_ID,
        task_index: input.task_index ?? 1,
        prompt,
        title: titleForPrompt(prompt),
        work_dir: input.work_dir ?? DOCS_WORKSPACE,
        additional_work_dirs: input.additional_work_dirs ?? null,
        status: 'running',
        priority: 'high',
        cost: null,
        duration: null,
        favorite: false,
        assignee_profile_id: input.assignee_profile_id ?? DOCS_PROFILE_ID,
        project_id: DOCS_PROJECT_ID,
        created_at: DOCS_CAPTURE_TIME,
        updated_at: DOCS_CAPTURE_TIME,
      };
      createdDemoMessages = [
        {
          ...demoMessages[0],
          task_id: createdDemoTask.id,
          content: prompt,
        },
        {
          ...demoMessages[1],
          task_id: createdDemoTask.id,
          content: assistantPreviewForPrompt(prompt),
        },
      ];
      await route.fulfill(json(createdDemoTask));
      return;
    }
    const unassigned = searchParams.get('unassigned') === 'true';
    const projectId = searchParams.get('project_id');
    const tasks = createdDemoTask ? [createdDemoTask, ...demoTasks] : demoTasks;
    await route.fulfill(
      json(
        unassigned
          ? tasks.filter((task) => !task.project_id)
          : projectId
            ? tasks.filter((task) => task.project_id === projectId)
            : tasks,
      ),
    );
    return;
  }

  if (pathname === '/db/messages' && request.method() === 'POST') {
    const input = requestJson<{
      task_id: string;
      type: string;
      content: string;
      message_id: string;
      attachments: string;
    }>(route);
    await route.fulfill(
      json({
        id: 99,
        task_id: input.task_id ?? DOCS_TASK_ID,
        type: input.type ?? 'user',
        content: input.content ?? '',
        tool_name: null,
        tool_input: null,
        tool_output: null,
        tool_use_id: null,
        subtype: null,
        error_message: null,
        attachments: input.attachments ?? null,
        message_id: input.message_id ?? 'docs-msg-created',
        cost: null,
        usage_input: null,
        usage_output: null,
        usage_cache_read: null,
        usage_cache_creation: null,
        model: null,
        created_at: DOCS_CAPTURE_TIME,
      }),
    );
    return;
  }

  if (pathname === '/db/media-versions' && request.method() === 'POST') {
    await route.fulfill(json({ success: true }));
    return;
  }

  if (pathname.match(/^\/db\/tasks\/[^/]+\/messages$/)) {
    const taskId = pathname.split('/')[3];
    await route.fulfill(
      json(
        createdDemoTask?.id === taskId && createdDemoMessages
          ? createdDemoMessages
          : demoMessages,
      ),
    );
    return;
  }

  if (pathname.match(/^\/db\/tasks\/[^/]+\/files$/)) {
    const taskId = pathname.split('/')[3];
    await route.fulfill(json(filesForTask(taskId)));
    return;
  }

  if (pathname.match(/^\/db\/tasks\/[^/]+\/media-versions$/)) {
    const taskId = pathname.split('/')[3];
    await route.fulfill(json(mediaVersionsForTask(taskId)));
    return;
  }

  if (pathname.match(/^\/db\/tasks\/[^/]+\/usage$/)) {
    await route.fulfill(
      json({
        total_input: 46_000,
        total_output: 8400,
        model: 'claude-sonnet-4-5',
        cost: 1.42,
      }),
    );
    return;
  }

  if (pathname.match(/^\/db\/tasks\/[^/]+$/)) {
    const task = taskForPath(pathname);
    if (!task) {
      await route.fulfill(json({ error: 'Task not found' }, 404));
      return;
    }
    await route.fulfill(json(task));
    return;
  }

  if (pathname === '/db/projects') {
    await route.fulfill(json([demoProject]));
    return;
  }

  if (pathname === `/db/projects/${DOCS_PROJECT_ID}`) {
    await route.fulfill(json(demoProject));
    return;
  }

  if (pathname === `/db/projects/${DOCS_PROJECT_ID}/tasks`) {
    await route.fulfill(
      json(demoTasks.filter((task) => task.project_id === DOCS_PROJECT_ID)),
    );
    return;
  }

  if (pathname === '/db/agent-profiles') {
    await route.fulfill(json(demoAgentProfiles));
    return;
  }

  if (pathname === '/db/dashboard/stats') {
    await route.fulfill(
      json({
        tasks: { running: 1, completed: 2, error: 0, stopped: 1 },
        activeProjects: 1,
        totalCost: 12.34,
      }),
    );
    return;
  }

  if (pathname === '/db/dashboard/task-flow') {
    await route.fulfill(
      json([
        { date: '2026-04-28', created: 2, completed: 1, failed: 0 },
        { date: '2026-04-29', created: 3, completed: 2, failed: 0 },
        { date: '2026-04-30', created: 4, completed: 3, failed: 1 },
        { date: '2026-05-01', created: 3, completed: 4, failed: 0 },
        { date: '2026-05-02', created: 1, completed: 2, failed: 0 },
        { date: '2026-05-03', created: 2, completed: 2, failed: 0 },
        { date: '2026-05-04', created: 5, completed: 3, failed: 0 },
      ]),
    );
    return;
  }

  if (pathname === '/db/dashboard/cost-summary') {
    await route.fulfill(json([]));
    return;
  }

  if (pathname === '/db/activity') {
    await route.fulfill(
      json([
        {
          id: 'docs-activity-1',
          actor_type: 'agent',
          event_type: 'task.created',
          entity_type: 'task',
          entity_id: DOCS_TASK_ID,
          project_id: DOCS_PROJECT_ID,
          metadata: null,
          created_at: '2026-05-04T11:58:00',
        },
        {
          id: 'docs-activity-2',
          actor_type: 'agent',
          event_type: 'project.created',
          entity_type: 'project',
          entity_id: DOCS_PROJECT_ID,
          project_id: DOCS_PROJECT_ID,
          metadata: null,
          created_at: '2026-05-04T10:30:00',
        },
        {
          id: 'docs-activity-3',
          actor_type: 'agent',
          event_type: 'task.status_changed',
          entity_type: 'task',
          entity_id: 'docs-task-reporting',
          project_id: DOCS_PROJECT_ID,
          metadata: null,
          created_at: '2026-05-03T17:20:00',
        },
      ]),
    );
    return;
  }

  if (pathname === '/observability/cost') {
    await route.fulfill(json(costRollup(searchParams.get('group_by'))));
    return;
  }

  if (pathname.match(/^\/observability\/tasks\/[^/]+\/trace$/)) {
    await route.fulfill(json({ events: [] }));
    return;
  }

  if (pathname.match(/^\/observability\/tasks\/[^/]+\/trace\/subscribe$/)) {
    await route.fulfill(text('', 'text/event-stream'));
    return;
  }

  if (pathname === '/automation') {
    await route.fulfill(json({ success: true, data: demoAutomations }));
    return;
  }

  if (pathname.match(/^\/automation\/[^/]+$/)) {
    await route.fulfill(json({ success: true, data: demoAutomations[0] }));
    return;
  }

  if (pathname.match(/^\/automation\/[^/]+\/runs$/)) {
    await route.fulfill(json({ success: true, data: [] }));
    return;
  }

  if (pathname.match(/^\/automation\/[^/]+\/(run|toggle)$/)) {
    await route.fulfill(json({ success: true, data: demoAutomations[0] }));
    return;
  }

  if (pathname === '/plugins') {
    await route.fulfill(json({ plugins: [] }));
    return;
  }

  if (pathname === '/plugins/discovered') {
    await route.fulfill(json({ plugins: demoPlugins }));
    return;
  }

  if (pathname === '/design/projects') {
    if (request.method() === 'POST') {
      await route.fulfill(json({ project: designProjectForCreate(route) }));
      return;
    }
    await route.fulfill(json({ projects: demoDesignProjects }));
    return;
  }

  if (pathname.match(/^\/design\/projects\/[^/]+\/capabilities$/)) {
    const projectId = decodeURIComponent(pathname.split('/')[3] ?? '');
    await route.fulfill(
      json({
        capabilities: {},
        budget: demoDesignBudget,
        projectId,
      }),
    );
    return;
  }

  if (pathname.match(/^\/design\/projects\/[^/]+\/files$/)) {
    await route.fulfill(json({ files: [] }));
    return;
  }

  if (pathname.match(/^\/design\/projects\/[^/]+$/)) {
    const projectId = decodeURIComponent(pathname.split('/')[3] ?? '');
    await route.fulfill(json({ project: designProjectById(projectId) }));
    return;
  }

  if (pathname === '/design/design-jury/status') {
    await route.fulfill(json({ enabled: false }));
    return;
  }

  if (pathname === '/design/design-systems') {
    await route.fulfill(json({ designSystems: demoDesignSystems }));
    return;
  }

  if (pathname === '/design/skills') {
    await route.fulfill(json({ skills: demoDesignSkills }));
    return;
  }

  if (pathname === '/design/prompt-templates') {
    await route.fulfill(
      json({
        templates: promptTemplatesForSurface(searchParams.get('surface')),
      }),
    );
    return;
  }

  if (pathname === '/graphify/status') {
    await route.fulfill(
      json({
        state: 'idle',
        lastRunAt: DOCS_CAPTURE_TIME,
        lastDurationMs: 12_400,
        lastError: null,
        manifestUpdatedAt: DOCS_CAPTURE_TIME,
        graphHtmlPath: null,
        graphJsonPath: null,
        reportPath: 'graphify-out/GRAPH_REPORT.md',
        workDir: DOCS_WORKSPACE,
      }),
    );
    return;
  }

  if (pathname === '/graphify/report') {
    await route.fulfill(
      text(`# Demo graph report

Communities: frontend workspace, API runtime, desktop shell, and docs media.
God nodes: task state, capture scripts, and routing surfaces.
`),
    );
    return;
  }

  if (pathname === '/approvals') {
    const status = searchParams.get('status');
    await route.fulfill(
      json({
        approvals: status && status !== 'pending' ? [] : demoApprovals,
      }),
    );
    return;
  }

  if (pathname === '/approvals/stream') {
    await route.fulfill(
      text(
        `event: snapshot\ndata: ${JSON.stringify({ approvals: demoApprovals })}\n\n`,
        'text/event-stream',
      ),
    );
    return;
  }

  if (pathname === '/cloud-storage/connections') {
    await route.fulfill(
      json({ items: demoCloudConnections, nextCursor: null }),
    );
    return;
  }

  if (pathname.match(/^\/cloud-storage\/connections\/[^/]+\/browse$/)) {
    await route.fulfill(
      json({
        items: demoCloudAssets,
        nextCursor: null,
        path: searchParams.get('path') ?? '/',
      }),
    );
    return;
  }

  if (pathname.match(/^\/cloud-storage\/connections\/[^/]+\/search$/)) {
    await route.fulfill(
      json({
        items: demoCloudAssets,
        nextCursor: null,
        query: searchParams.get('q') ?? '',
      }),
    );
    return;
  }

  if (pathname === '/files/stat') {
    const body = requestJson<{ path: string }>(route);
    const fixture = await binaryFileFixture(body.path);
    await route.fulfill(
      json({
        exists: Boolean(body.path),
        isFile: Boolean(body.path),
        isDirectory: false,
        size: fixture.size,
        mtime: DOCS_CAPTURE_TIME,
      }),
    );
    return;
  }

  if (pathname === '/files/read-binary') {
    const body = requestJson<{ path: string }>(route);
    const fixture = await binaryFileFixture(body.path);
    await route.fulfill(
      json({
        success: true,
        fileName: fixture.fileName,
        content: fixture.content,
        size: fixture.size,
      }),
    );
    return;
  }

  if (pathname.match(/^\/files\/snapshots\/[^/]+$/)) {
    await route.fulfill(json({ snapshots: [] }));
    return;
  }

  if (pathname.match(/^\/runs\/[^/]+\/tree$/)) {
    await route.fulfill(
      json({
        tree: [],
        rollup: {
          total: 0,
          running: 0,
          completed: 0,
          failed: 0,
          pending: 0,
        },
      }),
    );
    return;
  }

  if (pathname.match(/^\/ag-ui\/history\/[^/]+$/)) {
    await route.fulfill(json({ messages: [] }));
    return;
  }

  await route.fulfill(
    json({ error: `Docs capture fixture missing for ${pathname}` }, 404),
  );
}

async function captureImage(
  appUrl: string,
  entry: ReturnType<typeof getDocMediaEntries>[number],
) {
  const outputDir = rawEntryDir(entry);
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      colorScheme: entry.captureProfile.colorScheme,
      deviceScaleFactor: entry.captureProfile.deviceScaleFactor,
      forcedColors: entry.captureProfile.forcedColors,
      reducedMotion: entry.captureProfile.reducedMotion,
      viewport: entry.captureProfile.viewport,
    });
    await installDeterministicBrowserState(context);
    const page = await context.newPage();

    try {
      await prepareAppForDocsCapture(page);
      await page.goto(`${appUrl}${entry.route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      if (entry.waitFor) {
        await page.waitForSelector(entry.waitFor, { timeout: 10_000 });
      }
      await page.waitForTimeout(700);
      await preparePageForCapture(page, entry, { still: true });
      for (const step of entry.steps) {
        await executeStep(page, step);
        await applyPrivacyMasks(page, entry.privacyMasks);
      }
      await page.screenshot({
        path: path.join(outputDir, 'source.png'),
        type: 'png',
        fullPage: false,
      });
      await writeCaptureMetadata(outputDir, {
        id: entry.id,
        kind: 'image',
        page: entry.page,
        slot: entry.slot,
        route: entry.route,
        seed: entry.seed,
        viewport: entry.viewport,
        captureProfile: entry.captureProfile,
        theme: entry.theme,
        selectors: {
          waitFor: entry.waitFor,
          masks: entry.privacyMasks.map((mask) => mask.selector),
          steps: entry.steps.map((step) => step.label),
        },
        capturedAt: new Date().toISOString(),
        source: 'source.png',
      });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function captureVideo(
  appUrl: string,
  entry: Extract<
    ReturnType<typeof getDocMediaEntries>[number],
    { kind: 'video' }
  >,
) {
  const outputDir = rawEntryDir(entry);
  await fs.mkdir(outputDir, { recursive: true });
  const videoCaptureProfile = {
    ...entry.captureProfile,
    deviceScaleFactor: VIDEO_CAPTURE_DEVICE_SCALE_FACTOR,
    recordVideo: {
      size: entry.captureProfile.viewport,
    },
  };

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      colorScheme: videoCaptureProfile.colorScheme,
      deviceScaleFactor: videoCaptureProfile.deviceScaleFactor,
      forcedColors: videoCaptureProfile.forcedColors,
      reducedMotion: videoCaptureProfile.reducedMotion,
      viewport: videoCaptureProfile.viewport,
      recordVideo: {
        dir: outputDir,
        size: videoCaptureProfile.recordVideo.size,
      },
    });
    await installDeterministicBrowserState(context);
    const page = await context.newPage();
    const captureStartedAt = Date.now();

    try {
      await prepareAppForDocsCapture(page);
      await page.goto(`${appUrl}${entry.route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      if (entry.waitFor) {
        await page.waitForSelector(entry.waitFor, { timeout: 10_000 });
      }

      await preparePageForCapture(page, entry, { still: false });
      await page.waitForTimeout(VIDEO_CAPTURE_PRE_ROLL_MS);

      for (const step of entry.steps) {
        await executeStep(page, step);
        await applyPrivacyMasks(page, entry.privacyMasks);
      }
      const targetDurationMs =
        entry.camera.durationMs ??
        entry.budgets.maxDurationMs ??
        DEFAULT_POST_STEP_VIDEO_HOLD_MS;
      const sourceStartMs = entry.camera.sourceStartMs ?? 0;
      const elapsedMs = Date.now() - captureStartedAt;
      await page.waitForTimeout(
        Math.max(
          DEFAULT_POST_STEP_VIDEO_HOLD_MS,
          targetDurationMs + sourceStartMs - elapsedMs + VIDEO_CAPTURE_TAIL_MS,
        ),
      );
    } finally {
      const video = page.video();
      await page.close();

      if (video) {
        const sourcePath = await video.path();
        await fs.rename(sourcePath, path.join(outputDir, 'source.webm'));
      }
    }
  } finally {
    await browser.close();
  }

  await writeCaptureMetadata(outputDir, {
    id: entry.id,
    kind: 'video',
    page: entry.page,
    slot: entry.slot,
    route: entry.route,
    seed: entry.seed,
    viewport: entry.viewport,
    captureProfile: videoCaptureProfile,
    theme: entry.theme,
    selectors: {
      waitFor: entry.waitFor,
      masks: entry.privacyMasks.map((mask) => mask.selector),
      steps: entry.steps.map((step) => step.label),
    },
    capturedAt: new Date().toISOString(),
    source: 'source.webm',
  });
}

async function prepareAppForDocsCapture(page: Page) {
  await page.route('**/*', fulfillDocsApiMock);

  await page.addInitScript((slug) => {
    localStorage.setItem(`${slug}_setupCompleted`, 'true');
    localStorage.setItem(`${slug}_onboardingCompleted`, 'true');
    localStorage.setItem(`${slug}_onboardingVersion`, '1');
    localStorage.setItem(`${slug}_quickstart_step`, 'completed');
  }, APP_SLUG);
}

async function main() {
  const options = parseDocsMediaCliArgs();
  const appUrl = getArgValue('--app-url') ?? DEFAULT_APP_URL;
  const entries = getDocMediaEntries({ only: options.only });

  if (options.only && entries.length === 0) {
    throw new Error(`No docs media entries match --only=${options.only}`);
  }

  if (options.dryRun) {
    console.log(`Planned docs captures (${entries.length}):`);
    for (const entry of entries) {
      console.log(
        `  - ${entry.id}: ${entry.kind} ${appUrl}${entry.route} -> ${rawEntryDir(entry)}`,
      );
    }
    return;
  }

  for (const entry of entries) {
    console.log(`Capturing ${entry.id}...`);
    resetMutableCaptureState();
    if (entry.kind === 'image') {
      await captureImage(appUrl, entry);
    } else {
      await captureVideo(appUrl, entry);
    }
  }

  console.log(`Captured ${entries.length} docs media entrie(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
