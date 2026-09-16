import fs from 'node:fs/promises';
import path from 'node:path';

import { validatePath } from '@/shared/services/ffmpeg';
import {
  FrameworkExtractError,
  getReferenceFramework,
} from '@/shared/video/reference/framework-extract';
import { lintFramework } from '@/shared/video/reference/framework-lint';
import { readReferenceEnvelope } from '@/shared/video/reference/store';
import { renderFrameworkThumbnailSvg } from '@/shared/video/reference/thumbnail';
import { getProject, getVideoWorkspaceRoot } from '@/shared/video/store';
import {
  createCustomTemplateId,
  getCustomTemplatesDir,
  saveCustomTemplate,
} from '@/shared/video/templates/custom-loader';
import type {
  VideoTemplate,
  VideoTemplateAssetPlan,
  VideoTemplateInput,
  VideoTemplateSceneSeed,
} from '@/shared/video/templates/types';
import type {
  FrameworkSection,
  FrameworkSlot,
  TranscriptData,
  VideoFramework,
  VideoReference,
} from '@/shared/video/types';

export function frameworkToTemplate(
  framework: VideoFramework,
  input: { targetMs?: number; thumbnailUrl: string } = {
    thumbnailUrl: '',
  },
): VideoTemplate {
  const targetMs = Math.max(
    1000,
    input.targetMs ?? framework.totalDuration.typicalMs,
  );
  const scenes: VideoTemplateSceneSeed[] = framework.sections.map((section) => {
    const durationMs = Math.max(
      500,
      Math.round(section.timing.proportion * targetMs),
    );
    const primary = section.slots[0]!;
    return {
      durationMs,
      intent: section.purpose,
      assetPlan: slotToAssetPlan(primary, inputKey(section, primary)),
      slotId: primary.id,
      role: section.role,
    };
  });
  const inputs = framework.sections.flatMap((section) =>
    section.slots.map((slot) => slotToInput(section, slot)),
  );
  const typicalSec = Math.max(1, Math.round(targetMs / 1000));
  const minSec = Math.min(
    typicalSec,
    Math.max(1, Math.round(framework.totalDuration.minMs / 1000)),
  );
  const maxSec = Math.max(
    typicalSec,
    Math.max(1, Math.round(framework.totalDuration.maxMs / 1000)),
  );
  const palette = framework.systems
    .flatMap((system) => system.style?.palette ?? [])
    .find(Boolean);
  return {
    id: createCustomTemplateId(framework.displayName),
    displayName: framework.displayName,
    category: framework.category,
    thumbnailUrl: input.thumbnailUrl,
    durationSec: {
      typical: typicalSec,
      min: minSec,
      max: maxSec,
    },
    aspectRatios: framework.aspectRatios,
    hook: framework.hook,
    pace: framework.pace,
    pricingHint: { low: 0, high: 0 },
    inputs,
    storyboardSeed: {
      intent: framework.displayName,
      scenes,
    },
    styleDefaults: {
      ...(palette ? { primaryColor: palette } : {}),
      ...(framework.systems[0]?.style?.fontFamily
        ? { fontFamily: framework.systems[0].style.fontFamily }
        : {}),
    },
    providerHints: {},
    version: 1,
    source: 'custom',
    license: 'proprietary',
    frameworkProvenance: {
      referenceId: framework.provenance.referenceId,
      ...(framework.provenance.referenceUrl
        ? { referenceUrl: framework.provenance.referenceUrl }
        : {}),
      extractedAt: framework.provenance.extractedAt,
      extractedBy: framework.provenance.extractedBy,
    },
  };
}

export async function materializeFrameworkTemplate(
  projectId: string,
  referenceId: string,
  input: { targetMs?: number } = {},
): Promise<VideoTemplate> {
  const loaded = await getReferenceFramework(projectId, referenceId);
  if (!loaded) {
    throw new FrameworkExtractError(
      'Extract a framework before materializing a template.',
      'missing-reading',
    );
  }
  if (loaded.stale) {
    throw new FrameworkExtractError(
      'Framework is stale. Re-extract before saving a template.',
      'stale',
    );
  }
  const reference = await requireReference(projectId, referenceId);
  const transcript = (
    await readReferenceEnvelope<TranscriptData>(
      projectId,
      referenceId,
      'transcript',
    )
  )?.data;
  const draft = frameworkToTemplate(loaded.framework, {
    targetMs: input.targetMs,
    thumbnailUrl: '',
  });
  lintFramework(draft, {
    referenceId,
    contentHash: reference.contentHash,
    transcript,
  });
  const svg = renderFrameworkThumbnailSvg(loaded.framework.sections);
  const thumbnailUrl = await writeThumbnail(draft.id, svg);
  const template = await saveCustomTemplate({
    ...draft,
    thumbnailUrl,
  });
  lintFramework(template, {
    referenceId,
    contentHash: reference.contentHash,
    transcript,
  });
  return template;
}

export function searchVideoTemplates(
  templates: VideoTemplate[],
  filters: { role?: string; referenceId?: string; search?: string } = {},
): VideoTemplate[] {
  return templates.filter((template) => {
    if (
      filters.referenceId &&
      template.frameworkProvenance?.referenceId !== filters.referenceId
    ) {
      return false;
    }
    if (
      filters.role &&
      !template.storyboardSeed.scenes.some(
        (scene) => scene.role === filters.role,
      )
    ) {
      return false;
    }
    if (filters.search) {
      const haystack = [
        template.displayName,
        template.category,
        template.frameworkProvenance?.referenceId ?? '',
        ...template.storyboardSeed.scenes.map((scene) => scene.role ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(filters.search.toLowerCase())) return false;
    }
    return true;
  });
}

function slotToAssetPlan(
  slot: FrameworkSlot,
  assetKey: string,
): VideoTemplateAssetPlan {
  const fallback = slot.fallback;
  if (fallback.kind === 'ai-image') {
    return { kind: 'ai-image', prompt: fallback.promptTemplate };
  }
  if (fallback.kind === 'ai-clip') {
    return { kind: 'ai-clip', prompt: fallback.promptTemplate };
  }
  if (fallback.kind === 'broll-search') {
    return { kind: 'broll-search', query: fallback.queryTemplate };
  }
  if (fallback.kind === 'tts-narration') {
    return { kind: 'tts-narration', text: fallback.textTemplate };
  }
  return { kind: 'existing', assetKey };
}

function slotToInput(
  section: FrameworkSection,
  slot: FrameworkSlot,
): VideoTemplateInput {
  const key = inputKey(section, slot);
  if (slot.fallback.kind === 'ask-user') {
    return {
      key,
      kind: 'asset',
      label: `${section.role} ${slot.kind}`,
      required: slot.required,
      assetKind: slot.kind.includes('audio') ? 'audio' : 'video',
    };
  }
  if (slot.fallback.kind === 'tts-narration') {
    return {
      key,
      kind: 'longText',
      label: `${section.role} narration`,
      required: slot.required,
      default: slot.fallback.textTemplate,
    };
  }
  return {
    key,
    kind: 'text',
    label: `${section.role} ${slot.kind}`,
    required: slot.required,
  };
}

function inputKey(section: FrameworkSection, slot: FrameworkSlot): string {
  return `${section.role}_${slot.kind}_${slot.id}`
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^([^a-zA-Z])/, 's$1');
}

async function writeThumbnail(
  templateId: string,
  svg: string,
): Promise<string> {
  const dir = validatePath(
    path.join(getCustomTemplatesDir(), 'thumbnails'),
    getVideoWorkspaceRoot(),
    'write',
  );
  await fs.mkdir(dir, { recursive: true });
  const filePath = validatePath(
    path.join(dir, `${templateId}.svg`),
    getVideoWorkspaceRoot(),
    'write',
  );
  await fs.writeFile(filePath, svg);
  return `templates/thumbnails/${templateId}.svg`;
}

async function requireReference(
  projectId: string,
  referenceId: string,
): Promise<VideoReference> {
  const reference = (await getProject(projectId)).videoReferences?.find(
    (item) => item.id === referenceId,
  );
  if (!reference) {
    throw new FrameworkExtractError('Reference not found.', 'missing-reading');
  }
  return reference;
}
