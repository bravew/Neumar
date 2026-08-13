import type {
  VideoAspectRatio,
  VideoTimelineTransition,
  VideoTransitionDirection,
  VideoNarrationSegment,
  VideoProject,
  VideoStoryboard,
  VideoStoryboardScene,
} from '@/shared/types/video';
import {
  isVideoTransitionKind,
  normalizeVideoTransition,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import type { VideoProjectEditorActions } from './editorTypes';
import type { AgentActionRecord } from './useAgentDock';

interface ExecuteAgentActionInput {
  action: AgentActionRecord;
  project: VideoProject;
  actions: VideoProjectEditorActions;
  aspectRatio: VideoAspectRatio;
}

export async function executeAgentAction({
  action,
  project,
  actions,
  aspectRatio,
}: ExecuteAgentActionInput): Promise<void> {
  switch (action.name) {
    case 'regenerateScene':
      await actions.regenerateScene(requireString(action, 'sceneId'), {
        prompt: getString(action.args, 'prompt'),
        durationMs: getNumber(action.args, 'durationMs'),
      });
      return;

    case 'setTransition':
      await patchScene(project, actions, requireString(action, 'sceneId'), {
        transition: readTransition(action),
      });
      return;

    case 'setCaption':
      await patchScene(project, actions, requireString(action, 'sceneId'), {
        caption: {
          text: requireString(action, 'text'),
          style: findScene(project.storyboard, requireString(action, 'sceneId'))
            ?.caption?.style,
        },
      });
      return;

    case 'generateMusic':
      await actions.generateMusic({
        prompt: requireString(action, 'prompt'),
        durationMs:
          getNumber(action.args, 'durationMs') ?? totalDuration(project),
        tempoBpm: getNumber(action.args, 'tempoBpm'),
        provider: 'elevenlabs-music',
      });
      return;

    case 'addNarration':
      await addNarration(project, actions, action);
      return;

    case 'render':
      await actions.renderProject(readAspectRatio(action, aspectRatio));
      return;

    case 'cancelRender':
      await actions.cancelRender();
      return;

    case 'addScene':
      await addScene(project, actions, action, aspectRatio);
      return;

    case 'removeScene':
      await removeScene(project, actions, requireString(action, 'sceneId'));
      return;

    case 'searchLinkedAssets':
      await actions.searchLinkedAssets({
        query: getString(action.args, 'query'),
        role: readLinkedRole(action),
        limit: 6,
      });
      return;

    case 'attachAsset':
      await actions.attachLinkedAsset(
        requireString(action, 'assetId'),
        getString(action.args, 'sceneId'),
      );
      return;
  }
}

async function patchScene(
  project: VideoProject,
  actions: VideoProjectEditorActions,
  sceneId: string,
  patch: Partial<VideoStoryboardScene>,
) {
  const storyboard = requireStoryboard(project);
  await actions.updateStoryboard({
    ...storyboard,
    scenes: storyboard.scenes.map((scene) =>
      scene.id === sceneId ? { ...scene, ...patch } : scene,
    ),
  });
}

async function addNarration(
  project: VideoProject,
  actions: VideoProjectEditorActions,
  action: AgentActionRecord,
) {
  const storyboard = requireStoryboard(project);
  const sceneId = requireString(action, 'sceneId');
  const existing = new Map(
    (storyboard.narration?.segments ?? []).map((segment) => [
      segment.sceneId,
      segment,
    ]),
  );
  const segments: VideoNarrationSegment[] = storyboard.scenes.map((scene) => {
    const current = existing.get(scene.id);
    return {
      id: current?.id ?? randomUUID(),
      sceneId: scene.id,
      text:
        scene.id === sceneId
          ? requireString(action, 'text')
          : (current?.text ?? scene.caption?.text ?? scene.intent),
      voiceId: getString(action.args, 'voiceId') ?? current?.voiceId,
      provider: current?.provider,
    };
  });
  await actions.generateNarration({ segments });
}

async function addScene(
  project: VideoProject,
  actions: VideoProjectEditorActions,
  action: AgentActionRecord,
  aspectRatio: VideoAspectRatio,
) {
  const storyboard = requireStoryboard(project);
  const plan = getRecord(action.args, 'plan') ?? {};
  const captionText = getCaptionText(plan);
  const newScene: VideoStoryboardScene = {
    id: randomUUID(),
    durationMs: getNumber(plan, 'durationMs') ?? 3000,
    intent: getString(plan, 'intent') ?? action.summary,
    ...(captionText ? { caption: { text: captionText } } : {}),
    transition: 'cut',
    assetPlan: {
      kind: 'ai-image',
      prompt: getString(plan, 'intent') ?? action.summary,
      aspectRatio,
    },
  };
  const afterSceneId = getString(action.args, 'afterSceneId');
  const index = storyboard.scenes.findIndex(
    (scene) => scene.id === afterSceneId,
  );
  const scenes =
    index >= 0
      ? [
          ...storyboard.scenes.slice(0, index + 1),
          newScene,
          ...storyboard.scenes.slice(index + 1),
        ]
      : [...storyboard.scenes, newScene];
  await actions.updateStoryboard({
    ...storyboard,
    scenes,
    totalDurationMs: scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
  });
}

async function removeScene(
  project: VideoProject,
  actions: VideoProjectEditorActions,
  sceneId: string,
) {
  const storyboard = requireStoryboard(project);
  const scenes = storyboard.scenes.filter((scene) => scene.id !== sceneId);
  if (scenes.length === storyboard.scenes.length)
    throw new Error('Scene not found');
  if (scenes.length === 0)
    throw new Error('Storyboard needs at least one scene');
  await actions.updateStoryboard({
    ...storyboard,
    scenes,
    totalDurationMs: scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
  });
}

function requireStoryboard(project: VideoProject): VideoStoryboard {
  if (!project.storyboard) throw new Error('Storyboard required');
  return project.storyboard;
}

function findScene(
  storyboard: VideoStoryboard | undefined,
  sceneId: string,
): VideoStoryboardScene | undefined {
  return storyboard?.scenes.find((scene) => scene.id === sceneId);
}

function totalDuration(project: VideoProject): number {
  return (
    project.storyboard?.totalDurationMs ??
    project.storyboard?.scenes.reduce(
      (sum, scene) => sum + scene.durationMs,
      0,
    ) ??
    30000
  );
}

function requireString(action: AgentActionRecord, key: string): string {
  const value = getString(action.args, key);
  if (!value) throw new Error(`${key} required`);
  return value;
}

function getString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === 'string' ? item : undefined;
}

function getNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const item = value[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function getRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const item = value[key];
  return Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : undefined;
}

function getCaptionText(plan: Record<string, unknown>): string | undefined {
  const caption = getRecord(plan, 'caption');
  return caption ? getString(caption, 'text') : undefined;
}

function readAspectRatio(
  action: AgentActionRecord,
  fallback: VideoAspectRatio,
): VideoAspectRatio {
  const value = getString(action.args, 'aspectRatio');
  return value === '16:9' ||
    value === '9:16' ||
    value === '1:1' ||
    value === '4:5'
    ? value
    : fallback;
}

function readTransition(
  action: AgentActionRecord,
): VideoStoryboardScene['transition'] {
  const value =
    getString(action.args, 'transition') ??
    getString(action.args, 'kind') ??
    getString(action.args, 'transitionKind');
  const kind = isVideoTransitionKind(value) ? value : 'cut';
  const direction = readTransitionDirection(action.args);
  const durationMs = getNumber(action.args, 'durationMs');
  if (!direction && durationMs == null) return kind;
  return normalizeVideoTransition({
    kind,
    direction,
    durationMs,
  } satisfies VideoTimelineTransition);
}

function readTransitionDirection(
  args: Record<string, unknown>,
): VideoTransitionDirection | undefined {
  const value = getString(args, 'direction');
  return value === 'from-left' ||
    value === 'from-right' ||
    value === 'from-top' ||
    value === 'from-bottom'
    ? value
    : undefined;
}

function readLinkedRole(action: AgentActionRecord) {
  const value = getString(action.args, 'role');
  return value === 'reference' || value === 'b-roll' ? value : 'context';
}
