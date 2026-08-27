import type {
  Asset,
  AssetKind,
  CreativeAssetDescriptor,
  CreativeAssetRole,
  CreativeAssetMaterializationState,
  CreativeAssetReference,
  CreativeAssetRights,
} from '@/shared/assets/types';
import type {
  DesignAssetProvenance,
  DesignOutput,
  DesignProject,
} from '@/shared/types/design-mode';
import type {
  VideoLinkedSource,
  VideoMediaItem,
  VideoProject,
} from '@/shared/types/video';

import {
  CREATIVE_WORKFLOW_STEPS,
  type CreativeWorkflowAction,
  type CreativeWorkflowAssetSummary,
  type CreativeWorkflowState,
  type CreativeWorkflowStep,
  type CreativeWorkflowStepState,
} from './types';

const CREATIVE_ASSET_KINDS = [
  'image',
  'video',
  'audio',
  'pdf',
  'text',
  'doc',
  'other',
] as const satisfies readonly AssetKind[];

const ACTION_BY_STEP = {
  intent: 'describe-intent',
  assets: 'add-assets',
  plan: 'create-plan',
  generate: 'generate-media',
  review: 'review-output',
  export: 'export-output',
} as const satisfies Record<CreativeWorkflowStep, CreativeWorkflowAction['id']>;

const PROMPT_EXCERPT_MAX_LENGTH = 160;

export function deriveVideoCreativeWorkflowState(
  project: VideoProject,
): CreativeWorkflowState {
  const videoAssets = project.assets.map((asset) =>
    videoMediaItemToCreativeAssetDescriptor(asset, {
      projectId: project.id,
      usageCount: countVideoMediaUsage(project, asset.id),
    }),
  );
  const linkedAssets = (project.linkedSources ?? []).map((source) =>
    videoLinkedSourceToCreativeAssetDescriptor(source, project.id),
  );
  const assets = [...videoAssets, ...linkedAssets];
  const storyboardScenes = project.storyboard?.scenes ?? [];
  const hasAssets =
    assets.length > 0 ||
    (project.sources?.length ?? 0) > 0 ||
    (project.linkedSources?.length ?? 0) > 0;
  const hasPlan =
    storyboardScenes.length > 0 ||
    (project.scenes?.length ?? 0) > 0 ||
    Boolean(project.timeline);
  const hasStoryboardIntent =
    hasText(project.storyboard?.intent) ||
    storyboardScenes.some((scene) => hasText(scene.intent));
  const hasIntent =
    hasText(project.prompt) ||
    hasText(project.script) ||
    hasStoryboardIntent ||
    hasPlan;
  const hasApprovedPlan =
    project.storyboard?.status === 'approved' ||
    (project.scenes?.length ?? 0) > 0 ||
    Boolean(project.timeline);
  const hasGeneratedMedia =
    videoAssets.some((asset) => asset.role === 'generated') ||
    (project.scenes?.some((scene) => scene.clips.length > 0) ?? false);
  const renderStatus = project.render?.status?.toLowerCase();
  const renderFailed = isFailureStatus(renderStatus);
  const hasOutput =
    (project.outputs?.length ?? 0) > 0 || hasText(project.render?.outputPath);
  const currentStep = videoCurrentStep({
    hasIntent,
    hasAssets,
    hasPlan,
    hasApprovedPlan,
    hasGeneratedMedia,
    hasOutput,
    renderFailed,
  });
  const complete = new Set<CreativeWorkflowStep>();
  if (hasIntent) complete.add('intent');
  if (hasAssets) complete.add('assets');
  if (hasApprovedPlan) complete.add('plan');
  if (hasGeneratedMedia) complete.add('generate');
  if (hasOutput) {
    complete.add('review');
    complete.add('export');
  }

  return {
    mode: 'video',
    projectId: project.id,
    title: project.name,
    currentStep,
    steps: buildStepStates(currentStep, complete, {
      failedStep: renderFailed ? 'review' : undefined,
      sourceSteps: {
        intent: 'brief',
        assets: 'brief',
        plan: hasApprovedPlan ? 'plan' : 'board',
        generate: 'generate',
        review: 'preview',
        export: 'preview',
      },
    }),
    primaryAction: primaryActionFor(currentStep, renderFailed),
    // Count only the project's own assets. A linked source is a *folder* the
    // project reads from, so counting it as one asset made the header report
    // one more than every asset list in the editor.
    assetSummary: summarizeAssets(videoAssets),
    assets,
    source: { kind: 'video-project', status: project.render?.status },
    updatedAt: project.updatedAt,
  };
}

export function deriveDesignCreativeWorkflowState(
  project: DesignProject,
): CreativeWorkflowState {
  const assets = project.outputs.map((output) =>
    designOutputToCreativeAssetDescriptor(output, project.id),
  );
  const hasIntent =
    hasText(project.title) ||
    Object.keys(project.brief).length > 0 ||
    Boolean(project.intent);
  const hasAssets =
    (project.craftRefs?.length ?? 0) > 0 ||
    project.inspirationDesignSystemIds.length > 0 ||
    (project.linkedContextDirs?.length ?? 0) > 0 ||
    (project.contextPacks?.length ?? 0) > 0 ||
    (project.media?.references?.length ?? 0) > 0 ||
    assets.length > 0;
  const status = project.status;
  const hasPlan =
    status !== 'draft' ||
    Boolean(project.promptTemplate) ||
    Boolean(project.skillId) ||
    Boolean(project.designSystemId);
  const hasGeneratedOutput = assets.length > 0;
  const failed = status === 'failed';
  const complete = new Set<CreativeWorkflowStep>();
  if (hasIntent) complete.add('intent');
  if (hasAssets) complete.add('assets');
  if (hasPlan || hasGeneratedOutput) complete.add('plan');
  if (hasGeneratedOutput) complete.add('generate');
  if (status === 'complete' || hasGeneratedOutput) complete.add('review');
  if (status === 'complete') complete.add('export');

  const currentStep = designCurrentStep({
    hasIntent,
    hasAssets,
    hasPlan,
    hasGeneratedOutput,
    status,
  });

  return {
    mode: 'design',
    projectId: project.id,
    title: project.title,
    currentStep,
    steps: buildStepStates(currentStep, complete, {
      failedStep: failed ? 'review' : undefined,
    }),
    primaryAction: primaryActionFor(currentStep, failed),
    assetSummary: summarizeAssets(assets),
    assets,
    source: { kind: 'design-project', status },
    updatedAt: project.updatedAt,
  };
}

export function catalogAssetToCreativeAssetDescriptor(
  asset: Asset,
  options: { projectId?: string; scope?: string } = {},
): CreativeAssetDescriptor {
  const provenance = recordFromUnknown(asset.provenance);
  const matchingAttachments = options.projectId
    ? asset.attachments.filter(
        (attachment) =>
          attachment.scopeId === options.projectId &&
          (!options.scope || attachment.scope === options.scope),
      )
    : [];
  const attachmentRole = creativeAssetRoleFromUnknown(
    matchingAttachments[0]?.role,
  );
  return {
    id: asset.id,
    title: asset.title ?? asset.description ?? asset.sourceId ?? asset.id,
    kind: asset.kind,
    role:
      attachmentRole ?? (asset.source === 'ai_gen' ? 'generated' : 'source'),
    source: asset.source,
    sourceId: asset.sourceId ?? undefined,
    provider: stringFromRecord(provenance, 'provider') ?? asset.source,
    model: stringFromRecord(provenance, 'model'),
    promptHash: stringFromRecord(provenance, 'promptHash'),
    promptExcerpt:
      stringFromRecord(provenance, 'promptExcerpt') ??
      promptExcerptFrom(stringFromRecord(provenance, 'prompt')),
    references: referencesFromUnknown(provenance?.references),
    dimensions: dimensionsFrom(asset.width, asset.height),
    durationMs: positiveNumber(asset.durationMs),
    bytes: asset.bytes,
    mime: asset.mime,
    tags: asset.tags,
    materialization: catalogMaterialization(asset),
    rights: rightsFromRecord(provenance),
    usageCount: options.projectId
      ? matchingAttachments.length
      : asset.attachments.length,
    currentPlacement: {
      kind: 'catalog',
      assetId: asset.id,
      projectId: options.projectId,
      usedInProject: matchingAttachments.length > 0,
    },
    createdAt: asset.importedAt,
    updatedAt: asset.modifiedAt,
    rawPath: asset.storagePath,
    thumbPath: asset.thumbPath,
    previewPath: asset.previewPath,
  };
}

export function videoMediaItemToCreativeAssetDescriptor(
  asset: VideoMediaItem,
  options: { projectId?: string; usageCount?: number } = {},
): CreativeAssetDescriptor {
  return {
    id: asset.id,
    title: asset.provenance?.sourceDisplayName ?? asset.source,
    kind: asset.kind,
    role: isGeneratedVideoAsset(asset) ? 'generated' : 'source',
    source: asset.provenance?.catalogAssetId
      ? 'asset_catalog'
      : 'video_project',
    sourceId: asset.provenance?.sourceId ?? asset.provenance?.catalogAssetId,
    provider: asset.provenance?.provider,
    model: stringFromRecord(asset.provenance, 'model'),
    promptHash: stringFromRecord(asset.provenance, 'promptHash'),
    promptExcerpt:
      stringFromRecord(asset.provenance, 'promptExcerpt') ??
      promptExcerptFrom(stringFromRecord(asset.provenance, 'prompt')),
    references: referencesFromUnknown(asset.provenance?.references),
    dimensions: dimensionsFrom(asset.metadata.width, asset.metadata.height),
    durationMs: positiveNumber(asset.metadata.durationMs),
    bytes: positiveNumber(asset.metadata.fileSize) ?? asset.bytesTotal,
    mime: mimeFromVideoKind(asset.kind),
    tags: [],
    materialization: videoMaterialization(asset),
    rights: rightsFromVideo(asset),
    usageCount: options.usageCount ?? 0,
    currentPlacement: {
      kind: 'video-project',
      projectId: options.projectId,
      assetId: asset.id,
      sceneId: asset.provenance?.generatedFor?.sceneId,
      clipId: asset.provenance?.generatedFor?.clipId,
      usedInProject: (options.usageCount ?? 0) > 0,
    },
    rawPath: asset.path,
    thumbPath: asset.provenance?.thumbnailUrl ?? null,
    previewPath: asset.proxy?.url ?? asset.path,
  };
}

export function videoLinkedSourceToCreativeAssetDescriptor(
  source: VideoLinkedSource,
  projectId?: string,
): CreativeAssetDescriptor {
  return {
    id: source.id,
    title: source.displayName,
    kind: 'other',
    role: 'source',
    source: 'linked_source',
    sourceId: source.rootPath,
    references: [],
    tags: source.filters?.types ?? [],
    materialization:
      source.index.state === 'error'
        ? 'failed'
        : source.index.state === 'fresh'
          ? 'ready'
          : 'remote-only',
    usageCount: source.index.fileCount ?? 0,
    currentPlacement: {
      kind: 'video-project',
      projectId,
      assetId: source.id,
      usedInProject: true,
    },
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    rawPath: source.rootPath,
  };
}

export function designOutputToCreativeAssetDescriptor(
  output: DesignOutput,
  projectId?: string,
  provenance?: DesignAssetProvenance,
): CreativeAssetDescriptor {
  return {
    id: output.id,
    title: output.path.split('/').pop() ?? output.id,
    kind: assetKindFromString(output.kind, output.mime),
    role: 'design-output',
    source: 'design_project',
    sourceId: provenance?.taskId ?? output.providerId ?? output.taskId,
    provider: provenance?.provider ?? output.provider,
    model: provenance?.model ?? output.model,
    promptHash: provenance?.promptHash,
    promptExcerpt: promptExcerptFrom(provenance?.promptSnapshot),
    references: referencesFromDesignProvenance(provenance),
    tags: [],
    materialization: 'ready',
    usageCount: 1,
    currentPlacement: {
      kind: 'design-output',
      projectId,
      assetId: output.id,
      path: output.path,
      usedInProject: true,
    },
    createdAt: provenance?.createdAt ?? output.createdAt,
    updatedAt: output.createdAt,
    rawPath: output.path,
    previewPath: output.path,
    mime: output.mime,
  };
}

function videoCurrentStep(state: {
  hasIntent: boolean;
  hasAssets: boolean;
  hasPlan: boolean;
  hasApprovedPlan: boolean;
  hasGeneratedMedia: boolean;
  hasOutput: boolean;
  renderFailed: boolean;
}): CreativeWorkflowStep {
  if (!state.hasIntent) return 'intent';
  if (!state.hasAssets) return 'assets';
  if (!state.hasPlan || !state.hasApprovedPlan) return 'plan';
  if (state.renderFailed) return 'review';
  if (state.hasOutput) return 'export';
  if (!state.hasGeneratedMedia) return 'generate';
  if (!state.hasOutput) return 'review';
  return 'export';
}

function designCurrentStep(state: {
  hasIntent: boolean;
  hasAssets: boolean;
  hasPlan: boolean;
  hasGeneratedOutput: boolean;
  status: DesignProject['status'];
}): CreativeWorkflowStep {
  if (state.status === 'failed') return 'review';
  if (!state.hasIntent) return 'intent';
  if (!state.hasAssets) return 'assets';
  if (!state.hasPlan) return 'plan';
  if (state.status === 'generating' || state.status === 'rendering') {
    return 'generate';
  }
  if (!state.hasGeneratedOutput) return 'generate';
  if (state.status === 'complete') return 'export';
  return 'review';
}

function buildStepStates(
  currentStep: CreativeWorkflowStep,
  complete: Set<CreativeWorkflowStep>,
  options: {
    failedStep?: CreativeWorkflowStep;
    sourceSteps?: Partial<Record<CreativeWorkflowStep, string>>;
  } = {},
): CreativeWorkflowStepState[] {
  const currentIndex = CREATIVE_WORKFLOW_STEPS.indexOf(currentStep);
  return CREATIVE_WORKFLOW_STEPS.map((step, index) => {
    const status =
      options.failedStep === step
        ? 'failed'
        : currentStep === step
          ? 'active'
          : complete.has(step)
            ? 'complete'
            : index <= currentIndex
              ? 'ready'
              : 'not-started';
    return {
      step,
      status,
      sourceStep: options.sourceSteps?.[step],
    };
  });
}

function primaryActionFor(
  step: CreativeWorkflowStep,
  failed: boolean,
): CreativeWorkflowAction {
  if (failed) return { id: 'recover-failure', step };
  return { id: ACTION_BY_STEP[step], step };
}

function summarizeAssets(
  assets: CreativeAssetDescriptor[],
): CreativeWorkflowAssetSummary {
  return assets.reduce<CreativeWorkflowAssetSummary>(
    (summary, asset) => {
      summary.total += 1;
      summary.byRole[asset.role] = (summary.byRole[asset.role] ?? 0) + 1;
      summary.byMaterialization[asset.materialization] =
        (summary.byMaterialization[asset.materialization] ?? 0) + 1;
      if (asset.role === 'generated') summary.generated += 1;
      if (asset.currentPlacement?.usedInProject) summary.used += 1;
      return summary;
    },
    {
      total: 0,
      byRole: {},
      byMaterialization: {},
      generated: 0,
      used: 0,
    },
  );
}

function countVideoMediaUsage(project: VideoProject, mediaId: string): number {
  return (
    project.scenes?.reduce(
      (count, scene) =>
        count + scene.clips.filter((clip) => clip.mediaId === mediaId).length,
      0,
    ) ?? 0
  );
}

function catalogMaterialization(
  asset: Asset,
): CreativeAssetMaterializationState {
  if (asset.indexState === 'failed') return 'failed';
  if (asset.storagePath) return 'local';
  return 'remote-only';
}

function videoMaterialization(
  asset: VideoMediaItem,
): CreativeAssetMaterializationState {
  if (asset.materializationState === 'hydrating') return 'materializing';
  if (asset.materializationState === 'error') return 'failed';
  if (asset.materializationState === 'referenced') return 'remote-only';
  if (asset.materializationState === 'ready') return 'ready';
  return asset.path.startsWith('catalog:') ? 'remote-only' : 'local';
}

function assetKindFromString(kind: string, mime?: string): AssetKind {
  if (isAssetKind(kind)) return kind;
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime?.startsWith('text/')) return 'text';
  return 'other';
}

function isAssetKind(value: string): value is AssetKind {
  return CREATIVE_ASSET_KINDS.some((kind) => kind === value);
}

function mimeFromVideoKind(kind: VideoMediaItem['kind']): string | undefined {
  if (kind === 'image') return 'image/*';
  if (kind === 'video') return 'video/*';
  if (kind === 'audio') return 'audio/*';
  return undefined;
}

function isGeneratedVideoAsset(asset: VideoMediaItem): boolean {
  return Boolean(
    asset.provenance?.generatedFor ||
    asset.provenance?.prompt ||
    asset.provenance?.jobId ||
    asset.source.startsWith('ai-'),
  );
}

function rightsFromVideo(
  asset: VideoMediaItem,
): CreativeAssetRights | undefined {
  if (
    !asset.provenance?.license &&
    !asset.provenance?.attribution &&
    asset.provenance?.attributionRequired === undefined
  ) {
    return undefined;
  }
  return {
    license: asset.provenance.license,
    attribution: asset.provenance.attribution,
    attributionRequired: asset.provenance.attributionRequired,
    commercialUse: 'unknown',
  };
}

function rightsFromRecord(
  record: Record<string, unknown> | null,
): CreativeAssetRights | undefined {
  if (!record) return undefined;
  const license = stringFromRecord(record, 'license');
  const attribution = stringFromRecord(record, 'attribution');
  const attributionRequired = booleanFromRecord(record, 'attributionRequired');
  if (!license && !attribution && attributionRequired === undefined) {
    return undefined;
  }
  return {
    license,
    attribution,
    attributionRequired,
    commercialUse: commercialUseFromUnknown(record.commercialUse),
  };
}

function referencesFromUnknown(value: unknown): CreativeAssetReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordFromUnknown(item);
    if (!record) return [];
    const kind = referenceKindFromUnknown(record.kind);
    if (!kind) return [];
    return [
      {
        kind,
        id: stringFromRecord(record, 'id'),
        label: stringFromRecord(record, 'label'),
        atMs: numberFromRecord(record, 'atMs'),
      },
    ];
  });
}

function referencesFromDesignProvenance(
  provenance: DesignAssetProvenance | undefined,
): CreativeAssetReference[] {
  return (
    provenance?.references?.map((reference) => ({
      kind: 'source',
      id: reference,
      label: reference,
    })) ?? []
  );
}

function creativeAssetRoleFromUnknown(
  value: unknown,
): CreativeAssetRole | undefined {
  if (
    value === 'source' ||
    value === 'reference' ||
    value === 'generated' ||
    value === 'timeline' ||
    value === 'design-output' ||
    value === 'export'
  ) {
    return value;
  }
  return undefined;
}

function referenceKindFromUnknown(
  value: unknown,
): CreativeAssetReference['kind'] | null {
  if (
    value === 'asset' ||
    value === 'frame' ||
    value === 'prompt' ||
    value === 'source' ||
    value === 'url'
  ) {
    return value;
  }
  return null;
}

function commercialUseFromUnknown(
  value: unknown,
): CreativeAssetRights['commercialUse'] {
  if (value === 'allowed' || value === 'restricted' || value === 'unknown') {
    return value;
  }
  return undefined;
}

function dimensionsFrom(
  width: number | null | undefined,
  height: number | null | undefined,
): CreativeAssetDescriptor['dimensions'] {
  if (!width || !height) return undefined;
  return { width, height };
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function promptExcerptFrom(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > PROMPT_EXCERPT_MAX_LENGTH
    ? `${trimmed.slice(0, PROMPT_EXCERPT_MAX_LENGTH - 3)}...`
    : trimmed;
}

function isFailureStatus(value: string | undefined): boolean {
  return value === 'failed' || value === 'error' || value === 'cancelled';
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringFromRecord(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function numberFromRecord(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanFromRecord(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}
