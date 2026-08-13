import { readContentGraph } from '@/shared/video/content-graph/persistence';
import { withProjectLock } from '@/shared/video/project-lock';
import {
  getProject,
  getVideoProjectRoot,
  writeProject,
} from '@/shared/video/store';
import {
  loadTemplateGallery,
  resolveDefaultTemplateGalleryRoots,
} from '@/shared/video/templates/gallery-loader';
import type { VideoProject } from '@/shared/video/types';

const DEFAULT_NATIVE_TEMPLATE_ID = 'frame-data-rollup';

export interface SetFrameNativeEnhancementInput {
  enabled: boolean;
  nativeTemplateId?: string;
}

export interface SetFrameNativeEnhancementResult {
  project: VideoProject;
  nodeId: string;
  enabled: boolean;
  nativeTemplateId: string | null;
}

export async function setFrameNativeEnhancement(
  projectId: string,
  nodeId: string,
  input: SetFrameNativeEnhancementInput,
): Promise<SetFrameNativeEnhancementResult> {
  return withProjectLock(projectId, async () => {
    const project = await getProject(projectId);
    const storyboard = project.storyboard;
    if (!storyboard) {
      throw new Error('setFrameNativeEnhancement: project storyboard missing');
    }

    const sceneIndex = storyboard.scenes.findIndex(
      (scene) => scene.htmlFrameSeed?.nodeId === nodeId,
    );
    if (sceneIndex < 0) {
      throw new Error(
        `setFrameNativeEnhancement: content-graph node "${nodeId}" not found in storyboard`,
      );
    }

    const scene = storyboard.scenes[sceneIndex]!;
    const seed = scene.htmlFrameSeed;
    if (!seed) {
      throw new Error(
        `setFrameNativeEnhancement: scene "${scene.id}" is missing htmlFrameSeed`,
      );
    }

    const nativeTemplateId =
      input.nativeTemplateId ?? DEFAULT_NATIVE_TEMPLATE_ID;
    const nextSeed = { ...seed };
    if (input.enabled) {
      const graph = await readContentGraph(projectId);
      const node = graph?.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) {
        throw new Error(
          `setFrameNativeEnhancement: content-graph node "${nodeId}" not found`,
        );
      }
      if (node.kind !== 'data') {
        throw new Error(
          `setFrameNativeEnhancement: native enhancement requires a data node, got "${node.kind}"`,
        );
      }

      const template = await resolveNativeTemplate(projectId, nativeTemplateId);
      nextSeed.renderOverride = {
        mode: 'native',
        templateId: template.id,
        engine: template.metadata.engine,
      };
    } else {
      delete nextSeed.renderOverride;
    }

    const scenes = storyboard.scenes.map((candidate, index) =>
      index === sceneIndex
        ? { ...candidate, htmlFrameSeed: nextSeed }
        : candidate,
    );
    const next: VideoProject = {
      ...project,
      storyboard: { ...storyboard, scenes },
      updatedAt: new Date().toISOString(),
    };
    await writeProject(next);
    return {
      project: next,
      nodeId,
      enabled: input.enabled,
      nativeTemplateId: input.enabled ? nativeTemplateId : null,
    };
  });
}

async function resolveNativeTemplate(projectId: string, templateId: string) {
  const roots = resolveDefaultTemplateGalleryRoots(
    getVideoProjectRoot(projectId),
  );
  const gallery = await loadTemplateGallery(roots);
  const template = gallery.templates.find(
    (candidate) => candidate.id === templateId,
  );
  if (!template) {
    throw new Error(
      `setFrameNativeEnhancement: native template "${templateId}" not found in gallery`,
    );
  }
  if (!template.metadata.native?.compositionId) {
    throw new Error(
      `setFrameNativeEnhancement: template "${templateId}" is missing native.compositionId`,
    );
  }
  return template;
}
