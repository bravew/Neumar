import { randomUUID } from 'node:crypto';

import {
  readContentGraph,
  selectTemplate,
  writeContentGraph,
  writeFrameHtml,
  writeTemplateVariables,
} from '../content-graph/persistence';
import { estimateStoryboardCostUsd } from '../cost-estimator';
import {
  addProjectAssetFromPath,
  createProject,
  getProject,
  setStoryboard,
  updateProject,
  type CreateVideoProjectInput,
} from '../store';
import type {
  AssetPlan,
  BrandKit,
  Storyboard,
  StoryboardScene,
  TemplateId,
  VideoProject,
  VideoTimeline,
} from '../types';
import { createCustomTemplateId, saveCustomTemplate } from './custom-loader';
import {
  buildHtmlTemplateFolder,
  loadHtmlGalleryTemplateSnapshot,
  type HtmlGalleryTemplateSnapshot,
} from './html-template-snapshot';
import { getVideoTemplate } from './index';
import type {
  TemplateExpansionInput,
  VideoTemplate,
  VideoTemplateAssetPlan,
  VideoTemplateCategory,
  VideoTemplateInput,
} from './types';

type TemplateValues = Record<string, string | number | boolean>;
type TemplateAssetIds = Record<string, string>;

interface ResolvedTemplateInputs {
  values: TemplateValues;
  assetPaths: Record<string, string>;
}

export async function createProjectFromTemplate(input: TemplateExpansionInput) {
  const template = await getStoryboardVideoTemplate(input.templateId);
  if (!template) {
    return createProjectFromHtmlGalleryTemplate(input);
  }
  const resolved = resolveTemplateInputs(template, input.inputs);
  const projectInput: CreateVideoProjectInput = {
    name:
      input.name?.trim() || interpolate(template.displayName, resolved.values),
    template:
      template.projectTemplateId ??
      categoryToProjectTemplate(template.category),
    prompt: interpolate(template.storyboardSeed.intent, resolved.values),
  };
  const project = await createProject(projectInput);
  const assetIds = await attachTemplateAssets(project.id, resolved.assetPaths);
  const storyboard = expandTemplateStoryboard(
    template,
    resolved.values,
    assetIds,
  );
  const brandKit = expandTemplateBrandKit(template, resolved.values);
  const withStoryboard = await setStoryboard(project.id, storyboard);

  const projectPatch = {
    templateSnapshot: snapshotTemplate(template),
    ...(brandKit ? { brandKit } : {}),
    ...templateTimelinePatch(withStoryboard, template),
  };
  const next = await updateProject(withStoryboard.id, projectPatch);
  return { project: next, template };
}

export async function applyTemplateToProject(
  projectId: string,
  input: TemplateExpansionInput,
) {
  const template = await getStoryboardVideoTemplate(input.templateId);
  if (!template) {
    return applyHtmlGalleryTemplateToProject(projectId, input);
  }
  const resolved = resolveTemplateInputs(template, input.inputs);
  const assetIds = await attachTemplateAssets(projectId, resolved.assetPaths);
  const storyboard = expandTemplateStoryboard(
    template,
    resolved.values,
    assetIds,
  );
  const brandKit = expandTemplateBrandKit(template, resolved.values);
  const projectPatch = {
    template:
      template.projectTemplateId ??
      categoryToProjectTemplate(template.category),
    prompt: interpolate(template.storyboardSeed.intent, resolved.values),
    templateSnapshot: snapshotTemplate(template),
    ...(brandKit ? { brandKit } : {}),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
  };
  const withStoryboard = await setStoryboard(projectId, storyboard);
  const next = await updateProject(withStoryboard.id, {
    ...projectPatch,
    ...templateTimelinePatch(withStoryboard, template),
  });
  return { project: next, template };
}

export function expandTemplateStoryboard(
  template: VideoTemplate,
  inputs: Record<string, unknown>,
  assetIds: TemplateAssetIds = {},
): Storyboard {
  const { values } = resolveTemplateInputs(template, inputs);
  const scenes: StoryboardScene[] = template.storyboardSeed.scenes.map(
    (scene) => ({
      id: randomUUID(),
      durationMs: scene.durationMs,
      intent: interpolate(scene.intent, values),
      transition: scene.transition,
      reframe: scene.reframe,
      caption: scene.caption
        ? {
            text: interpolate(scene.caption.text, values),
            style: scene.caption.style ?? template.styleDefaults.captionStyle,
          }
        : undefined,
      assetPlan: expandTemplateAssetPlan(scene.assetPlan, values, assetIds),
    }),
  );

  return {
    status: 'draft',
    intent: interpolate(template.storyboardSeed.intent, values),
    totalDurationMs: scenes.reduce(
      (total, scene) => total + scene.durationMs,
      0,
    ),
    costEstimateUsd: estimateStoryboardCostUsd({ scenes }),
    scenes,
    music: template.storyboardSeed.music
      ? {
          ...template.storyboardSeed.music,
          prompt: interpolate(template.storyboardSeed.music.prompt, values),
        }
      : undefined,
  };
}

export async function saveProjectAsTemplate(
  projectId: string,
  input: {
    displayName: string;
    category: VideoTemplateCategory;
    license: VideoTemplate['license'];
  },
): Promise<VideoTemplate> {
  const project = await getProject(projectId);
  const contentGraph = await readContentGraph(projectId);
  if (contentGraph && contentGraph.nodes.length > 0) {
    const result = await buildHtmlTemplateFolder(project, input);
    return result.template;
  }

  if (!project.storyboard) {
    throw new Error('Storyboard is required before saving a video template');
  }

  const snapshot = createTemplateSnapshotFromProject(project);
  const template: VideoTemplate = {
    id: createCustomTemplateId(input.displayName),
    displayName: input.displayName,
    category: input.category,
    thumbnailUrl: '',
    durationSec: {
      typical: Math.max(
        1,
        Math.round(project.storyboard.totalDurationMs / 1000),
      ),
      min: 1,
      max: Math.max(1, Math.round(project.storyboard.totalDurationMs / 1000)),
    },
    aspectRatios: project.settings?.defaultAspectRatios?.length
      ? project.settings.defaultAspectRatios
      : ['16:9'],
    hook: 'cold-open',
    pace: 'medium',
    pricingHint: project.storyboard.costEstimateUsd,
    inputs: snapshot.inputs,
    storyboardSeed: {
      intent: project.storyboard.intent,
      scenes: snapshot.scenes,
      music: project.storyboard.music
        ? {
            prompt: project.storyboard.music.prompt,
            durationMs: project.storyboard.music.durationMs,
            provider: project.storyboard.music.provider,
            model: project.storyboard.music.model,
            tempoBpm: project.storyboard.music.tempoBpm,
            mood: project.storyboard.music.mood,
            seed: project.storyboard.music.seed,
          }
        : undefined,
    },
    styleDefaults: snapshot.styleDefaults,
    providerHints: {},
    version: 1,
    source: 'custom',
    license: input.license,
    projectTemplateId: project.template,
  };

  return saveCustomTemplate(template);
}

async function getStoryboardVideoTemplate(
  templateId: string,
): Promise<VideoTemplate | null> {
  try {
    return await getVideoTemplate(templateId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('template not found')
    ) {
      return null;
    }
    throw error;
  }
}

async function createProjectFromHtmlGalleryTemplate(
  input: TemplateExpansionInput,
) {
  const snapshot = await loadHtmlGalleryTemplateSnapshot(input.templateId);
  const project = await createProject({
    name: input.name?.trim() || snapshot.template.displayName,
    template: 'custom',
    prompt: snapshot.template.storyboardSeed.intent,
  });
  await hydrateProjectFromHtmlTemplate(project.id, snapshot, input.inputs);
  const next = await updateProject(project.id, {
    template: 'custom',
    prompt: snapshot.template.storyboardSeed.intent,
    templateSnapshot: snapshotTemplate(snapshot.template),
  });
  return { project: next, template: snapshot.template };
}

async function applyHtmlGalleryTemplateToProject(
  projectId: string,
  input: TemplateExpansionInput,
) {
  const snapshot = await loadHtmlGalleryTemplateSnapshot(input.templateId);
  await hydrateProjectFromHtmlTemplate(projectId, snapshot, input.inputs);
  const next = await updateProject(projectId, {
    template: 'custom',
    prompt: snapshot.template.storyboardSeed.intent,
    templateSnapshot: snapshotTemplate(snapshot.template),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
  });
  return { project: next, template: snapshot.template };
}

async function hydrateProjectFromHtmlTemplate(
  projectId: string,
  snapshot: HtmlGalleryTemplateSnapshot,
  inputs: Record<string, unknown>,
): Promise<void> {
  await writeContentGraph(projectId, snapshot.contentGraph);
  for (const node of snapshot.contentGraph.nodes) {
    await writeFrameHtml(
      projectId,
      node.id,
      snapshot.frameHtml[node.id] ??
        '<!doctype html><html><body></body></html>',
    );
  }
  await selectTemplate(projectId, snapshot.galleryTemplate.id);
  await writeTemplateVariables(projectId, inputs);
}

function createTemplateSnapshotFromProject(project: VideoProject): {
  inputs: VideoTemplateInput[];
  scenes: VideoTemplate['storyboardSeed']['scenes'];
  styleDefaults: VideoTemplate['styleDefaults'];
} {
  if (!project.storyboard) {
    throw new Error('Storyboard is required before saving a video template');
  }
  const inputs: VideoTemplateInput[] = [];
  const assetKeyById = new Map<string, string>();

  const addAssetInput = (assetId: string): string => {
    const existing = assetKeyById.get(assetId);
    if (existing) return existing;
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    const key = `asset${assetKeyById.size + 1}`;
    assetKeyById.set(assetId, key);
    inputs.push({
      key,
      kind: 'asset',
      label: assetInputLabel(asset, key),
      required: true,
      assetKind: asset?.kind,
    });
    return key;
  };

  const scenes = project.storyboard.scenes.map((scene) => ({
    durationMs: scene.durationMs,
    intent: scene.intent,
    transition: scene.transition,
    reframe: scene.reframe,
    caption: scene.caption,
    assetPlan: snapshotAssetPlan(scene, addAssetInput),
  }));
  const styleDefaults = snapshotStyleDefaults(project, inputs);
  return { inputs, scenes, styleDefaults };
}

function resolveTemplateInputs(
  template: VideoTemplate,
  rawInputs: Record<string, unknown>,
): ResolvedTemplateInputs {
  const values: TemplateValues = {};
  const assetPaths: Record<string, string> = {};
  for (const input of template.inputs) {
    const value = rawInputs[input.key] ?? input.default;
    if (input.required && (value === undefined || value === '')) {
      throw new Error(`Template input "${input.key}" is required`);
    }
    if (value === undefined) continue;

    if (input.kind === 'asset') {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(
          `Template asset input "${input.key}" must be a workspace path`,
        );
      }
      assetPaths[input.key] = value;
      values[input.key] = value;
      continue;
    }

    if (input.kind === 'enum') {
      if (typeof value !== 'string' || !(input.enum ?? []).includes(value)) {
        throw new Error(
          `Template input "${input.key}" must match an allowed option`,
        );
      }
      values[input.key] = value;
      continue;
    }

    if (input.kind === 'number') {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        throw new Error(
          `Template input "${input.key}" must be a finite number`,
        );
      }
      values[input.key] = numeric;
      continue;
    }

    if (typeof value === 'string' || typeof value === 'boolean') {
      values[input.key] = value;
    } else {
      throw new Error(`Template input "${input.key}" must be scalar`);
    }
  }
  return { values, assetPaths };
}

function interpolate(template: string, values: TemplateValues): string {
  return template.replace(
    /{{\s*(?:input\.)?([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g,
    (_match, key: string) => String(values[key] ?? ''),
  );
}

function expandTemplateBrandKit(
  template: VideoTemplate,
  values: TemplateValues,
): BrandKit | undefined {
  const primaryColor = template.styleDefaults.primaryColor
    ? interpolate(template.styleDefaults.primaryColor, values)
    : undefined;
  const fontFamily = template.styleDefaults.fontFamily
    ? interpolate(template.styleDefaults.fontFamily, values)
    : undefined;
  if (!primaryColor && !fontFamily) return undefined;
  return { primaryColor, fontFamily };
}

async function attachTemplateAssets(
  projectId: string,
  assetPaths: Record<string, string>,
): Promise<TemplateAssetIds> {
  const assetIds: TemplateAssetIds = {};
  for (const [key, assetPath] of Object.entries(assetPaths)) {
    const { asset } = await addProjectAssetFromPath(projectId, assetPath);
    assetIds[key] = asset.id;
  }
  return assetIds;
}

function snapshotTemplate(template: VideoTemplate) {
  return {
    id: template.id,
    displayName: template.displayName,
    version: template.version,
    source: template.source,
    storyboardSeed: template.storyboardSeed,
    ...(template.html
      ? {
          html: {
            engine: template.html.engine,
            aspectRatio: template.html.aspectRatio,
            durationSec: template.html.durationSec,
            contentGraph: template.html.contentGraph,
            provenance: template.html.provenance,
          },
        }
      : {}),
  };
}

function templateTimelinePatch(
  project: { timeline?: VideoTimeline },
  template: VideoTemplate,
): { timeline?: VideoTimeline } {
  const intro = template.storyboardSeed.intro;
  const outro = template.storyboardSeed.outro;
  if (!project.timeline || (!intro && !outro)) return {};
  return {
    timeline: {
      ...project.timeline,
      ...(intro ? { intro } : {}),
      ...(outro ? { outro } : {}),
    },
  };
}

function expandTemplateAssetPlan(
  plan: VideoTemplateAssetPlan,
  values: TemplateValues,
  assetIds: TemplateAssetIds,
): AssetPlan {
  if (plan.kind === 'existing') {
    return {
      kind: 'existing',
      assetId: requiredAssetId(plan.assetKey, assetIds),
      trimMs: plan.trimMs,
    };
  }
  if (plan.kind === 'ai-image') {
    return {
      ...plan,
      prompt: interpolate(plan.prompt, values),
      size: plan.size as Extract<AssetPlan, { kind: 'ai-image' }>['size'],
    } as AssetPlan;
  }
  if (plan.kind === 'ai-clip') {
    return { ...plan, prompt: interpolate(plan.prompt, values) };
  }
  if (plan.kind === 'broll-search') {
    return {
      ...plan,
      query: interpolate(plan.query, values),
      sourceIds: plan.sourceIds,
    };
  }
  if (plan.kind === 'image-pan') {
    return {
      kind: 'image-pan',
      assetId: requiredAssetId(plan.assetKey, assetIds),
      kenBurns: plan.kenBurns,
    };
  }
  return {
    ...plan,
    text: interpolate(plan.text, values),
    provider: plan.provider as Extract<
      AssetPlan,
      { kind: 'tts-narration' }
    >['provider'],
  };
}

function requiredAssetId(assetKey: string, assetIds: TemplateAssetIds): string {
  const assetId = assetIds[assetKey];
  if (!assetId) {
    throw new Error(`Template asset input "${assetKey}" is required`);
  }
  return assetId;
}

function snapshotAssetPlan(
  scene: StoryboardScene,
  addAssetInput: (assetId: string) => string,
): VideoTemplateAssetPlan {
  const plan = scene.assetPlan;
  if (plan.kind === 'existing') {
    return {
      kind: 'existing',
      assetKey: addAssetInput(plan.assetId),
      trimMs: plan.trimMs,
    };
  }
  if (plan.kind === 'ai-image') {
    return {
      kind: 'ai-image',
      prompt: plan.prompt,
      provider: plan.provider,
      aspectRatio: plan.aspectRatio,
      size: plan.size,
      seed: plan.seed,
    };
  }
  if (plan.kind === 'ai-clip') {
    return {
      kind: 'ai-clip',
      prompt: plan.prompt,
      refImageId: plan.refImageId,
      refImageTailId: plan.refImageTailId,
      provider: plan.provider,
      aspectRatio: plan.aspectRatio,
      durationMs: plan.durationMs,
      seed: plan.seed,
    };
  }
  if (plan.kind === 'broll-search') {
    return {
      kind: 'broll-search',
      query: plan.query,
      provider: plan.provider,
      pinnedHitId: plan.pinnedHitId,
      sourceIds: plan.sourceIds,
    };
  }
  if (plan.kind === 'tts-narration') {
    return {
      kind: 'tts-narration',
      text: plan.text,
      voiceId: plan.voiceId,
      provider: plan.provider,
    };
  }
  if (plan.kind === 'image-pan') {
    return {
      kind: 'image-pan',
      assetKey: addAssetInput(plan.assetId),
      kenBurns: plan.kenBurns,
    };
  }
  return {
    kind: 'ai-clip',
    prompt: scene.intent,
    aspectRatio: '16:9',
    durationMs: scene.durationMs,
    provider: 'seedance-2-0-fast',
  };
}

function snapshotStyleDefaults(
  project: VideoProject,
  inputs: VideoTemplateInput[],
): VideoTemplate['styleDefaults'] {
  const styleDefaults: VideoTemplate['styleDefaults'] = {};
  if (project.brandKit?.primaryColor) {
    inputs.push({
      key: 'brandPrimary',
      kind: 'color',
      label: 'Brand primary',
      default: project.brandKit.primaryColor,
    });
    styleDefaults.primaryColor = '{{brandPrimary}}';
  }
  if (project.brandKit?.fontFamily) {
    inputs.push({
      key: 'brandFont',
      kind: 'text',
      label: 'Brand font',
      default: project.brandKit.fontFamily,
    });
    styleDefaults.fontFamily = '{{brandFont}}';
  }
  return styleDefaults;
}

function assetInputLabel(
  asset: VideoProject['assets'][number] | undefined,
  fallback: string,
): string {
  if (!asset) return `Source ${fallback.replace('asset', '')}`;
  const basename = asset.path.split(/[\\/]/).at(-1) || asset.id;
  return basename.slice(0, 120);
}

function categoryToProjectTemplate(
  category: VideoTemplateCategory,
): TemplateId {
  if (category === 'ad') return 'ugc-ad';
  if (category === 'explainer') return 'explainer';
  if (category === 'podcast') return 'podcast';
  if (category === 'product') return 'product-reel';
  return 'custom';
}
