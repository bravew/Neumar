import { z } from 'zod';

import type { RunVerdict } from '@/core/agent/runtime-state';

export const designSurfaces = [
  'document',
  'image',
  'video',
  'audio',
  'deck',
  'prototype',
  'template',
  'campaign',
] as const;

export const designStatuses = [
  'draft',
  'ready',
  'generating',
  'rendering',
  'complete',
  'failed',
] as const;

export const designProjectIntents = [
  'landing-page',
  'app-screen',
  'os-widget',
  'live-artifact',
  'slide',
  'media',
  'other',
] as const;

export const audioKinds = [
  'speech',
  'voiceover',
  'music',
  'sfx',
  'ambience',
] as const;

export const mediaAspects = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '4:5',
  '5:4',
  '2:3',
  '3:2',
  '21:9',
] as const;

export const designSurfaceSchema = z.enum(designSurfaces);
export const designStatusSchema = z.enum(designStatuses);
export const designProjectIntentSchema = z.enum(designProjectIntents);
export const audioKindSchema = z.enum(audioKinds);
export const mediaAspectSchema = z.enum(mediaAspects);

export type DesignSurface = z.infer<typeof designSurfaceSchema>;
export type DesignProjectStatus = z.infer<typeof designStatusSchema>;
export type DesignProjectIntent = z.infer<typeof designProjectIntentSchema>;
export type AudioKind = z.infer<typeof audioKindSchema>;
export type MediaAspect = z.infer<typeof mediaAspectSchema>;

export const designOutputSchema = z.object({
  id: z.string(),
  kind: z.string(),
  path: z.string(),
  mime: z.string().optional(),
  provider: z.string().optional(),
  providerId: z.string().optional(),
  model: z.string().optional(),
  taskId: z.string().optional(),
  createdAt: z.string(),
});

export const designBudgetConfigSchema = z.object({
  maxImageGenerations: z.number().int().nonnegative().optional(),
  maxVideoJobs: z.number().int().nonnegative().optional(),
  maxVideoSeconds: z.number().int().nonnegative().optional(),
  maxAudioSeconds: z.number().int().nonnegative().optional(),
  maxRetryCount: z.number().int().nonnegative().optional(),
  maxStorageBytes: z.number().int().nonnegative().optional(),
  strictProviderMode: z.boolean().optional(),
});

export const designBudgetUsageSchema = z.object({
  imageGenerations: z.number().int().nonnegative(),
  videoJobs: z.number().int().nonnegative(),
  videoSeconds: z.number().int().nonnegative(),
  audioSeconds: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
});

export const promptTemplateSnapshotSchema = z.object({
  id: z.string(),
  surface: z.enum(['image', 'video']),
  title: z.string(),
  prompt: z.string(),
  summary: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  model: z.string().optional(),
  aspect: mediaAspectSchema.optional(),
  source: z
    .object({
      repo: z.string(),
      license: z.string(),
      author: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
});

export const designProjectUiSchema = z
  .object({
    fileTabs: z
      .object({
        order: z.array(z.string()),
      })
      .optional(),
    fileWorkspace: z
      .object({
        currentDirectory: z.string().max(500).nullable().optional(),
        sortBy: z.enum(['name', 'kind', 'updatedAt']).optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
        groupBy: z.enum(['none', 'kind', 'updatedAt']).optional(),
        kindFilter: z
          .enum(['all', 'html', 'image', 'svg', 'pdf', 'audio', 'video'])
          .optional(),
      })
      .optional(),
  })
  .optional();

const CODE_CONNECT_PROPS_MAX_BYTES = 4 * 1024;

const figmaUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        (url.hostname === 'figma.com' || url.hostname === 'www.figma.com') &&
        /^\/(design|file|proto)\//.test(url.pathname)
      );
    } catch {
      return false;
    }
  }, 'Figma URL must point to a figma.com design, file, or proto page');

const workspaceRelativeSourcePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => {
    const slashPath = value.replace(/\\/g, '/');
    return (
      !slashPath.includes('\0') &&
      !slashPath.startsWith('/') &&
      !/^[a-zA-Z]:\//.test(slashPath) &&
      !slashPath.split('/').includes('..')
    );
  }, 'sourcePath must be workspace-relative');

const httpsSourceUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'sourceUrl must be an HTTPS URL');

const codeConnectPropsSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => {
    try {
      const serialized = JSON.stringify(value);
      return (
        typeof serialized === 'string' &&
        Buffer.byteLength(serialized, 'utf-8') <= CODE_CONNECT_PROPS_MAX_BYTES
      );
    } catch {
      return false;
    }
  }, 'props must stay under 4 KB');

export const designFigmaContextSchema = z
  .object({
    url: figmaUrlSchema.optional(),
    fileKey: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{4,128}$/)
      .optional(),
    fileName: z.string().trim().max(160).optional(),
    nodeId: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9:_-]{1,120}$/)
      .optional(),
    nodeName: z.string().trim().max(160).optional(),
  })
  .refine((value) => value.url || value.fileKey, {
    message: 'Figma context requires a URL or fileKey',
  });

export const designCodeConnectComponentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  importPath: z.string().trim().min(1).max(300).optional(),
  sourcePath: workspaceRelativeSourcePathSchema.optional(),
  sourceUrl: httpsSourceUrlSchema.optional(),
  props: codeConnectPropsSchema.optional(),
  tokenUsage: z.array(z.string().trim().min(1).max(120)).max(80).default([]),
  notes: z.string().trim().max(1000).optional(),
});

export const designContextPackSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{3,80}$/),
    source: z.enum(['figma', 'code-connect', 'figma-code-connect']),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().max(1000).optional(),
    figma: designFigmaContextSchema.optional(),
    components: z.array(designCodeConnectComponentSchema).max(40).default([]),
    notes: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
    updatedAt: z.string().trim().max(80).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source !== 'code-connect' && !value.figma) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['figma'],
        message: 'Figma context is required for this context pack source',
      });
    }
    if (value.source !== 'figma' && value.components.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['components'],
        message: 'Code Connect context requires at least one component',
      });
    }
  });

export const designProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  workspaceRoot: z.string().max(1000).optional(),
  surface: designSurfaceSchema,
  intent: designProjectIntentSchema.default('other'),
  status: designStatusSchema,
  customInstructions: z.string().max(5000).optional(),
  skillId: z.string().nullable(),
  designSystemId: z.string().nullable(),
  inspirationDesignSystemIds: z.array(z.string()),
  craftRefs: z.array(z.string()),
  linkedContextDirs: z.array(z.string()).default([]),
  contextPacks: z.array(designContextPackSchema).max(8).default([]),
  brief: z.record(z.string(), z.unknown()),
  media: z
    .object({
      model: z.string().optional(),
      aspect: mediaAspectSchema.optional(),
      lengthSeconds: z.number().int().positive().optional(),
      durationSeconds: z.number().int().positive().optional(),
      voice: z.string().optional(),
      languageBoost: z.string().optional(),
      audioKind: audioKindSchema.optional(),
      imageStyle: z.string().optional(),
      references: z.array(z.string()).optional(),
      fidelity: z.enum(['wireframe', 'high-fidelity']).optional(),
      speakerNotes: z.boolean().optional(),
      animations: z.boolean().optional(),
    })
    .optional(),
  budget: designBudgetConfigSchema.optional(),
  promptTemplate: promptTemplateSnapshotSchema.optional(),
  ui: designProjectUiSchema,
  outputs: z.array(designOutputSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DesignOutput = z.infer<typeof designOutputSchema>;
export type DesignBudgetConfig = z.infer<typeof designBudgetConfigSchema>;
export type DesignBudgetUsage = z.infer<typeof designBudgetUsageSchema>;
export type DesignContextPack = z.infer<typeof designContextPackSchema>;
export type DesignFigmaContext = z.infer<typeof designFigmaContextSchema>;
export type DesignCodeConnectComponent = z.infer<
  typeof designCodeConnectComponentSchema
>;
export type PromptTemplateSnapshot = z.infer<
  typeof promptTemplateSnapshotSchema
>;
export type DesignProject = z.infer<typeof designProjectSchema>;

export const createDesignProjectSchema = z.object({
  title: z.string().trim().optional(),
  workspaceRoot: z.string().trim().max(1000).optional(),
  surface: designSurfaceSchema,
  intent: designProjectIntentSchema.optional(),
  customInstructions: z.string().max(5000).optional(),
  skillId: z.string().nullable().optional(),
  designSystemId: z.string().nullable().optional(),
  inspirationDesignSystemIds: z.array(z.string()).optional(),
  linkedContextDirs: z.array(z.string()).optional(),
  contextPacks: z.array(designContextPackSchema).max(8).optional(),
  brief: z.record(z.string(), z.unknown()).optional(),
  media: designProjectSchema.shape.media,
  budget: designBudgetConfigSchema.optional(),
  promptTemplate: promptTemplateSnapshotSchema.optional(),
});

export const patchDesignProjectSchema = z.object({
  title: z.string().trim().min(1).optional(),
  status: designStatusSchema.optional(),
  intent: designProjectIntentSchema.optional(),
  customInstructions: z.string().max(5000).optional(),
  skillId: z.string().nullable().optional(),
  designSystemId: z.string().nullable().optional(),
  inspirationDesignSystemIds: z.array(z.string()).optional(),
  craftRefs: z.array(z.string()).optional(),
  linkedContextDirs: z.array(z.string()).optional(),
  contextPacks: z.array(designContextPackSchema).max(8).optional(),
  brief: z.record(z.string(), z.unknown()).optional(),
  media: designProjectSchema.shape.media,
  budget: designBudgetConfigSchema.optional(),
  promptTemplate: promptTemplateSnapshotSchema.nullable().optional(),
  ui: designProjectUiSchema,
  outputs: z.array(designOutputSchema).optional(),
});

export type CreateDesignProjectInput = z.infer<
  typeof createDesignProjectSchema
>;
export type PatchDesignProjectInput = z.infer<typeof patchDesignProjectSchema>;

export interface DesignFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  updatedAt?: string;
  children?: DesignFileEntry[];
}

export interface DesignTaskRecord {
  taskId: string;
  projectId: string;
  surface: 'image' | 'video' | 'audio' | 'document';
  model: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  progressLines: string[];
  providerError: string | null;
  verdict?: RunVerdict;
  recoveryAction?: 'retry_generation';
  usedStubFallback: boolean;
  outputPath?: string;
  provider?: string;
  prompt?: string;
  requestedUnits?: Partial<DesignBudgetUsage>;
  budgetCheck?: {
    allowed: boolean;
    severity: 'none' | 'soft' | 'urgent' | 'blocked';
    message?: string;
    used: DesignBudgetUsage;
    requested: Partial<DesignBudgetUsage>;
    remaining: DesignBudgetUsage;
  };
}

export interface DesignLintFinding {
  id: string;
  severity: 'p0' | 'p1';
  message: string;
  path?: string;
  suggestion?: string;
}

export const designLiveArtifactSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('inline'),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal('project-file'),
    path: z.string().min(1),
    label: z.string().optional(),
  }),
]);

export const createDesignLiveArtifactSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  templateHtml: z.string().min(1).max(2_000_000),
  data: z.unknown().optional(),
  source: designLiveArtifactSourceSchema.optional(),
  connectorId: z.string().optional(),
});

export const designJuryRequestSchema = z.object({
  artifactPath: z.string().min(1).max(1000).optional(),
});

export type DesignLiveArtifactSource = z.infer<
  typeof designLiveArtifactSourceSchema
>;
export type CreateDesignLiveArtifactInput = z.infer<
  typeof createDesignLiveArtifactSchema
>;

export interface DesignLiveArtifact {
  id: string;
  projectId: string;
  title: string;
  status: 'ready' | 'refreshing' | 'failed';
  kind?: string;
  synthesized?: boolean;
  connectorId: string;
  source: DesignLiveArtifactSource;
  templatePath: string;
  dataPath: string;
  entrypointPath: string;
  provenancePath: string;
  refreshLogPath: string;
  createdAt: string;
  updatedAt: string;
  lastRefreshAt?: string;
  lastError?: string;
}

export interface DesignLiveArtifactProvenance {
  schema: 'neuma.design.live-artifact.provenance.v1';
  artifactId: string;
  projectId: string;
  connectorId: string;
  source: DesignLiveArtifactSource;
  generatedAt: string;
  generator: 'neuma-design-mode';
  templateHash: string;
  dataHash: string;
  outputPath: string;
}

export interface DesignLiveArtifactRefreshLogEntry {
  id: string;
  artifactId: string;
  at: string;
  status: 'ready' | 'failed';
  message?: string;
  dataHash?: string;
  outputPath?: string;
}

export interface DesignConnectorCatalogEntry {
  id: string;
  label: string;
  kind: 'local-project' | 'app-connector';
  access: 'read';
  description: string;
  configured: boolean;
  status: 'ready' | 'coming-soon';
}

export type DesignJuryRole =
  | 'designer'
  | 'critic'
  | 'brand'
  | 'accessibility'
  | 'copy';

export interface DesignJuryRoleScore {
  role: DesignJuryRole;
  score: number;
  evidence: string;
  mustFix: string[];
  quickWins: string[];
}

export interface CritiqueArtifactRef {
  runId: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  url: string;
}

export type PanelEvent =
  | {
      type: 'run_started';
      runId: string;
      protocolVersion: 'design-jury.v1';
      roles: string[];
      startedAt: string;
    }
  | { type: 'panelist_open'; runId: string; round: number; role: string }
  | {
      type: 'panelist_dim';
      runId: string;
      round: number;
      role: string;
      rating: number;
    }
  | {
      type: 'panelist_must_fix';
      runId: string;
      round: number;
      role: string;
      itemId: string;
      body: string;
    }
  | { type: 'panelist_close'; runId: string; round: number; role: string }
  | {
      type: 'round_end';
      runId: string;
      round: number;
      aggregate: { mustFix: number; quickWins: number; avgScore: number };
    }
  | {
      type: 'parser_warning';
      runId: string;
      round: number | null;
      warning: string;
    }
  | { type: 'shipped'; runId: string; artifactRef?: CritiqueArtifactRef }
  | { type: 'degraded'; runId: string; reason: string }
  | { type: 'interrupted'; runId: string }
  | { type: 'failed'; runId: string; error: string };

export interface DesignJuryRun {
  id: string;
  projectId: string;
  artifactPath: string;
  artifactRef?: CritiqueArtifactRef;
  status: 'running' | 'complete' | 'interrupted' | 'failed';
  protocolVersion: 'design-jury.v1';
  createdAt: string;
  completedAt?: string;
  overallScore: number;
  roles: DesignJuryRoleScore[];
  mustFix: string[];
  quickWins: string[];
  transcriptPath: string;
  summaryPath: string;
  error?: string;
  recoveryReason?: 'no_live_handle' | 'daemon_restart';
}
