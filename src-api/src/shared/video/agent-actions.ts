import { randomUUID } from 'node:crypto';

import type { TimelineOp } from '@neumar/video-ir';

import type {
  AspectRatio,
  Storyboard,
  StoryboardScene,
  TransitionKind,
  VideoEditorSelectionContext,
  VideoProject,
  VideoTranscriptSelectionContext,
} from '@/shared/video/types';

export type VideoAgentActionName =
  | 'regenerateScene'
  | 'addScene'
  | 'removeScene'
  | 'setTransition'
  | 'setTimelineBookend'
  | 'clearTimelineBookend'
  | 'setClipAudioSeam'
  | 'applyTimelineOp'
  | 'applyTimelineOps'
  | 'setCaption'
  | 'generateMusic'
  | 'addNarration'
  | 'render'
  | 'cancelRender'
  | 'verifyRender'
  | 'searchLinkedAssets'
  | 'attachAsset';

export interface VideoAgentContext {
  selectedSceneId?: string;
  projectAssetIds?: string[];
  aspectRatio?: AspectRatio;
  step?: string;
  transcriptSelection?: VideoTranscriptSelectionContext;
  editorSelection?: VideoEditorSelectionContext;
  pluginId?: string;
  pluginInputs?: Record<string, unknown>;
  approvedPluginCapabilities?: string[];
  lastReviewedPluginDigest?: string | null;
  pluginSignatureOk?: boolean | null;
}

export type VideoAgentActionArgs =
  | { sceneId: string; prompt: string; durationMs?: number }
  | {
      afterSceneId?: string;
      plan: {
        durationMs: number;
        intent: string;
        caption?: { text: string };
      };
    }
  | { sceneId: string }
  | { sceneId: string; transition: StoryboardScene['transition'] }
  | { position: 'intro' | 'outro'; kind: 'fade'; durationMs: number }
  | { position: 'intro' | 'outro' }
  | { clipId: string; mode: 'follow' | 'cut' }
  | { op: TimelineOp; summary?: string }
  | {
      ops: TimelineOp[];
      summary?: string;
      rippleImpact?: { downstreamClipCount: number; shiftMs: number };
    }
  | { sceneId: string; text: string }
  | { prompt: string; durationMs: number; tempoBpm?: number }
  | { sceneId: string; text: string; voiceId?: string }
  | { aspectRatio: AspectRatio; mode: 'speed' | 'reproducible' }
  | { outputPath?: string; maxIterations?: number }
  | {
      query?: string;
      role?: 'context' | 'b-roll' | 'reference';
      limit?: number;
    }
  | { assetId: string; sceneId?: string }
  | Record<string, never>;

export interface VideoAgentActionProposal {
  id: string;
  type: 'action';
  name: VideoAgentActionName;
  args: VideoAgentActionArgs;
  summary: string;
  reasoning?: VideoAgentActionReasoning;
  requiresApproval: true;
  status: 'pending';
}

export interface VideoAgentActionReasoning {
  rationale: string;
  considered: string[];
  sourceClips?: string[];
}

const SCENE_NUMBER_RE = /\bscene\s+(\d+)\b/i;
const SCENE_BETWEEN_RE =
  /\bbetween\s+(?:scenes?\s+)?(\d+)\s+(?:and|to|-)\s+(?:scenes?\s+)?(\d+)\b/i;
const BPM_RE = /\b(\d{2,3})\s*bpm\b/i;
const ASPECT_RE = /\b(16:9|9:16|1:1|4:5)\b/;
const QUOTED_TEXT_RE = /"([^"]+)"|'([^']+)'/;
const DURATION_MS_RE = /\b(\d{2,5})\s*ms\b/i;
const DURATION_SEC_RE =
  /\b(\d{1,3}(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i;

const DEFAULT_ACTION_SCENE_DURATION_MS = 3000;
const DEFAULT_RENDER_ASPECT_RATIO: AspectRatio = '16:9';
const TRANSITION_KEYWORDS: Array<[TransitionKind, RegExp]> = [
  ['clock-wipe', /\b(clock[- ]?wipe|radial wipe)\b/i],
  ['polygon-iris', /\b(polygon[- ]?iris|geometric iris)\b/i],
  ['soft-wipe', /\b(soft[- ]?wipe|feathered wipe)\b/i],
  ['zoom-in-out', /\b(zoom[- ]?in[- /]?out|zoom in out)\b/i],
  ['zoom-blur', /\b(zoom[- ]?blur|blurred zoom)\b/i],
  ['pixelize', /\b(pixelize|pixelated|pixel transition)\b/i],
  ['dissolve', /\b(dissolve)\b/i],
  ['cover', /\b(cover)\b/i],
  ['reveal', /\b(reveal)\b/i],
  ['flip', /\b(flip)\b/i],
  ['cube', /\b(cube|3d rotate|3d transition)\b/i],
  ['iris', /\b(iris|circle open|circle close)\b/i],
  ['wipe', /\b(wipe)\b/i],
  ['slide', /\b(slide)\b/i],
  ['fade', /\b(fade|crossfade)\b/i],
  ['cut', /\b(cut)\b/i],
];

export function proposeVideoAgentAction(
  project: VideoProject,
  message: string,
  context?: VideoAgentContext,
): VideoAgentActionProposal | null {
  const normalized = message.trim();
  if (!normalized) return null;

  if (wantsCancelRender(normalized)) {
    return action('cancelRender', {}, 'Cancel the current render.');
  }

  const storyboard = project.storyboard;
  const scene = resolveScene(storyboard, normalized, context);
  const lower = normalized.toLowerCase();

  if (wantsVerifyRender(lower)) {
    return action(
      'verifyRender',
      { outputPath: project.render?.outputPath, maxIterations: 3 },
      'Verify the latest render against the timeline and transcript.',
    );
  }

  if (context?.transcriptSelection && wantsTranscriptRangeEdit(lower)) {
    const selection = context.transcriptSelection;
    const trackId =
      trackIdForClip(project, selection.clipId) ?? primaryVideoTrackId(project);
    const op: TimelineOp = {
      kind: 'clip.removeTimeRange',
      ...(trackId ? { trackId } : {}),
      startMs: selection.startMs,
      endMs: selection.endMs,
      magnetic: true,
    };
    return action(
      'applyTimelineOps',
      {
        ops: [op],
        summary: 'Cut the selected transcript range from the timeline.',
        rippleImpact: estimateRippleImpact(project, selection, trackId),
      },
      'Cut the selected transcript range from the timeline.',
    );
  }

  if (wantsRender(lower)) {
    const aspectRatio =
      parseAspectRatio(normalized) ??
      context?.aspectRatio ??
      project.settings?.defaultAspectRatios?.[0] ??
      DEFAULT_RENDER_ASPECT_RATIO;
    return action(
      'render',
      { aspectRatio, mode: project.settings?.defaultRenderMode ?? 'speed' },
      `Render the project at ${aspectRatio}.`,
    );
  }

  if (wantsMusic(lower)) {
    const tempoBpm = parseTempoBpm(normalized);
    const durationMs =
      storyboard?.totalDurationMs ??
      sumSceneDurations(storyboard) ??
      DEFAULT_ACTION_SCENE_DURATION_MS * 4;
    return action(
      'generateMusic',
      {
        prompt: normalized,
        durationMs,
        tempoBpm,
      },
      tempoBpm
        ? `Generate a ${tempoBpm} bpm music bed.`
        : 'Generate a music bed for the storyboard.',
    );
  }

  const bookendPosition = parseBookendPosition(lower);
  if (bookendPosition && wantsClearBookend(lower)) {
    return action(
      'clearTimelineBookend',
      { position: bookendPosition },
      `Remove the ${bookendPosition} fade.`,
    );
  }

  if (bookendPosition && wantsBookend(lower)) {
    return action(
      'setTimelineBookend',
      {
        position: bookendPosition,
        kind: 'fade',
        durationMs: parseDurationMs(normalized) ?? 500,
      },
      `Set a ${bookendPosition} fade.`,
    );
  }

  if (scene && wantsAudioSeam(lower)) {
    const clipId = visualClipIdForScene(project, scene.id);
    if (clipId) {
      const mode =
        lower.includes('cut') || lower.includes('hard') ? 'cut' : 'follow';
      return action(
        'setClipAudioSeam',
        { clipId, mode },
        `Set the audio seam after ${sceneLabel(storyboard, scene)} to ${mode}.`,
      );
    }
  }

  if (scene && wantsTransition(lower)) {
    const transitionScene = resolveTransitionScene(
      storyboard,
      normalized,
      scene,
    );
    const transition = parseTransitionKind(normalized);
    return action(
      'setTransition',
      { sceneId: transitionScene.id, transition },
      `Set a ${transition} transition after ${sceneLabel(storyboard, transitionScene)}.`,
    );
  }

  if (scene && wantsCaption(lower)) {
    const text = extractQuotedText(normalized) ?? normalized;
    return action(
      'setCaption',
      { sceneId: scene.id, text },
      `Update the caption for ${sceneLabel(storyboard, scene)}.`,
    );
  }

  if (scene && wantsNarration(lower)) {
    const text =
      extractQuotedText(normalized) ?? scene.caption?.text ?? scene.intent;
    return action(
      'addNarration',
      { sceneId: scene.id, text },
      `Add narration for ${sceneLabel(storyboard, scene)}.`,
    );
  }

  if (scene && wantsRemoveScene(lower)) {
    return action(
      'removeScene',
      { sceneId: scene.id },
      `Remove ${sceneLabel(storyboard, scene)} from the storyboard.`,
    );
  }

  if (wantsAddScene(lower)) {
    return action(
      'addScene',
      {
        afterSceneId: scene?.id,
        plan: {
          durationMs:
            parseDurationMs(normalized) ?? DEFAULT_ACTION_SCENE_DURATION_MS,
          intent: normalized,
          caption: { text: extractQuotedText(normalized) ?? normalized },
        },
      },
      scene
        ? `Add a scene after ${sceneLabel(storyboard, scene)}.`
        : 'Add a new storyboard scene.',
    );
  }

  if (scene && wantsRegeneration(lower)) {
    return action(
      'regenerateScene',
      {
        sceneId: scene.id,
        prompt: buildRegenerationPrompt(scene, normalized),
        durationMs: scene.durationMs,
      },
      `Regenerate ${sceneLabel(storyboard, scene)}.`,
    );
  }

  return null;
}

function action(
  name: VideoAgentActionName,
  args: VideoAgentActionArgs,
  summary: string,
): VideoAgentActionProposal {
  return {
    id: randomUUID(),
    type: 'action',
    name,
    args,
    summary,
    reasoning: buildActionReasoning(name, args, summary),
    requiresApproval: true,
    status: 'pending',
  };
}

function buildActionReasoning(
  name: VideoAgentActionName,
  args: VideoAgentActionArgs,
  summary: string,
): VideoAgentActionReasoning {
  const sourceClips = [
    readArgString(args, 'assetId'),
    readArgString(args, 'outputPath'),
  ].filter((value): value is string => Boolean(value));
  return {
    rationale: summary,
    considered: actionConsiderations(name),
    sourceClips: sourceClips.length ? sourceClips : undefined,
  };
}

function actionConsiderations(name: VideoAgentActionName): string[] {
  switch (name) {
    case 'regenerateScene':
      return ['Selected scene intent', 'Current scene duration'];
    case 'addScene':
      return ['Storyboard order', 'Requested scene intent'];
    case 'removeScene':
      return ['Selected scene', 'Storyboard must keep at least one scene'];
    case 'setTransition':
      return ['Target scene boundary', 'Requested transition style'];
    case 'setTimelineBookend':
    case 'clearTimelineBookend':
      return ['Timeline bookend position', 'Requested fade duration'];
    case 'setClipAudioSeam':
      return ['Target clip seam', 'Requested audio seam mode'];
    case 'applyTimelineOp':
      return ['Timeline operation kind', 'Target clip or track'];
    case 'applyTimelineOps':
      return [
        'Timeline operation batch',
        'Selected transcript range',
        'Ripple impact on downstream clips',
      ];
    case 'setCaption':
    case 'addNarration':
      return ['Selected scene text', 'Existing caption or narration'];
    case 'generateMusic':
      return ['Storyboard duration', 'Requested tempo or mood'];
    case 'render':
      return ['Project render settings', 'Requested aspect ratio'];
    case 'cancelRender':
      return ['Current render state'];
    case 'verifyRender':
      return ['Latest rendered output', 'Timeline and transcript checks'];
    case 'searchLinkedAssets':
      return ['Search query', 'Linked-source role filters'];
    case 'attachAsset':
      return ['Linked asset id', 'Target scene if provided'];
  }
}

function readArgString(
  args: VideoAgentActionArgs,
  key: string,
): string | undefined {
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function resolveScene(
  storyboard: Storyboard | undefined,
  message: string,
  context?: VideoAgentContext,
): StoryboardScene | null {
  const scenes = storyboard?.scenes ?? [];
  if (scenes.length === 0) return null;

  const explicit = parseSceneIndex(message);
  if (explicit !== null) return scenes[explicit] ?? scenes[0] ?? null;

  if (context?.selectedSceneId) {
    const selected = scenes.find(
      (scene) => scene.id === context.selectedSceneId,
    );
    if (selected) return selected;
  }

  return scenes[0] ?? null;
}

function resolveTransitionScene(
  storyboard: Storyboard | undefined,
  message: string,
  fallback: StoryboardScene,
): StoryboardScene {
  const scenes = storyboard?.scenes ?? [];
  const between = SCENE_BETWEEN_RE.exec(message);
  if (!between) return fallback;

  const index = Number(between[1]) - 1;
  return scenes[index] ?? fallback;
}

function parseSceneIndex(message: string): number | null {
  const between = SCENE_BETWEEN_RE.exec(message);
  if (between) return Number(between[1]) - 1;

  const match = SCENE_NUMBER_RE.exec(message);
  if (!match) return null;
  return Number(match[1]) - 1;
}

function parseTempoBpm(message: string): number | undefined {
  const match = BPM_RE.exec(message);
  if (!match) return undefined;
  const value = Number(match[1]);
  return value >= 40 && value <= 240 ? value : undefined;
}

function parseAspectRatio(message: string): AspectRatio | undefined {
  const match = ASPECT_RE.exec(message);
  return match?.[1] as AspectRatio | undefined;
}

function parseDurationMs(message: string): number | undefined {
  const msMatch = DURATION_MS_RE.exec(message);
  if (msMatch) return Number(msMatch[1]);
  const match = DURATION_SEC_RE.exec(message);
  if (!match) return undefined;
  return Math.round(Number(match[1]) * 1000);
}

function parseBookendPosition(message: string): 'intro' | 'outro' | null {
  if (/\b(outro|ending|end|fade-out|fade out)\b/i.test(message)) {
    return 'outro';
  }
  if (/\b(intro|start|beginning|fade-in|fade in)\b/i.test(message)) {
    return 'intro';
  }
  return null;
}

function extractQuotedText(message: string): string | undefined {
  const match = QUOTED_TEXT_RE.exec(message);
  return match?.[1] ?? match?.[2];
}

function sumSceneDurations(storyboard: Storyboard | undefined): number | null {
  const scenes = storyboard?.scenes ?? [];
  if (scenes.length === 0) return null;
  return scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
}

function sceneLabel(
  storyboard: Storyboard | undefined,
  scene: StoryboardScene,
): string {
  const index = storyboard?.scenes.findIndex((entry) => entry.id === scene.id);
  return index !== undefined && index >= 0 ? `scene ${index + 1}` : 'the scene';
}

function buildRegenerationPrompt(
  scene: StoryboardScene,
  message: string,
): string {
  return `${scene.intent}. User requested: ${message}`;
}

function wantsRegeneration(message: string): boolean {
  return /\b(regenerate|rerender|re-render|remake|replace|wider shot|wide shot|closer shot|new shot)\b/i.test(
    message,
  );
}

function wantsTransition(message: string): boolean {
  return /\b(transition|fade|crossfade|slide|wipe|iris|dissolve|cover|reveal|flip|clock[- ]?wipe|cube|zoom[- ]?blur|zoom[- ]?in[- /]?out)\b/i.test(
    message,
  );
}

function parseTransitionKind(message: string): TransitionKind {
  return (
    TRANSITION_KEYWORDS.find(([, pattern]) => pattern.test(message))?.[0] ??
    'fade'
  );
}

function wantsBookend(message: string): boolean {
  return /\b(bookend|intro|outro|fade-in|fade-out|fade in|fade out)\b/i.test(
    message,
  );
}

function wantsClearBookend(message: string): boolean {
  return (
    /\b(remove|clear|disable|turn off|delete)\b/i.test(message) &&
    wantsBookend(message)
  );
}

function wantsAudioSeam(message: string): boolean {
  return (
    /\b(audio|sound|voiceover|voice over|narration)\b/i.test(message) &&
    /\b(seam|transition|crossfade|follow|cut|hard cut)\b/i.test(message)
  );
}

function visualClipIdForScene(
  project: VideoProject,
  sceneId: string,
): string | undefined {
  for (const track of project.timeline?.tracks ?? []) {
    if (
      track.kind !== 'video' &&
      track.kind !== 'broll' &&
      track.kind !== 'overlay'
    ) {
      continue;
    }
    const clip = track.clips.find((item) => item.sceneId === sceneId);
    if (clip?.kind === 'video' || clip?.kind === 'image') return clip.id;
  }
  return undefined;
}

function trackIdForClip(
  project: VideoProject,
  clipId: string | undefined,
): string | undefined {
  if (!clipId) return undefined;
  for (const track of project.timeline?.tracks ?? []) {
    if (track.clips.some((clip) => clip.id === clipId)) return track.id;
  }
  return undefined;
}

function primaryVideoTrackId(project: VideoProject): string | undefined {
  return project.timeline?.tracks.find((track) => track.kind === 'video')?.id;
}

function estimateRippleImpact(
  project: VideoProject,
  selection: VideoTranscriptSelectionContext,
  trackId: string | undefined,
): { downstreamClipCount: number; shiftMs: number } {
  const track =
    project.timeline?.tracks.find((candidate) => candidate.id === trackId) ??
    project.timeline?.tracks.find((candidate) => candidate.kind === 'video');
  return {
    downstreamClipCount:
      track?.clips.filter((clip) => clip.startMs >= selection.endMs).length ??
      0,
    shiftMs: -(selection.endMs - selection.startMs),
  };
}

function wantsMusic(message: string): boolean {
  return /\b(music|soundtrack|score|bed|beat|bpm)\b/i.test(message);
}

function wantsCaption(message: string): boolean {
  return /\b(caption|subtitle|subtitles|lower third|text overlay)\b/i.test(
    message,
  );
}

function wantsNarration(message: string): boolean {
  return /\b(narration|voiceover|voice over|tts|read this)\b/i.test(message);
}

function wantsRender(message: string): boolean {
  return /\b(render|export|make video|final video)\b/i.test(message);
}

function wantsVerifyRender(message: string): boolean {
  return (
    /\b(verify|check|audit|review|validate)\b/i.test(message) &&
    /\b(render|export|output|video)\b/i.test(message)
  );
}

function wantsCancelRender(message: string): boolean {
  return (
    /\b(cancel|stop)\b/i.test(message) && /\b(render|export)\b/i.test(message)
  );
}

function wantsAddScene(message: string): boolean {
  return (
    /\b(add|insert|create)\b/i.test(message) &&
    /\b(scene|shot)\b/i.test(message)
  );
}

function wantsRemoveScene(message: string): boolean {
  return (
    /\b(remove|delete|drop)\b/i.test(message) &&
    /\b(scene|shot)\b/i.test(message)
  );
}

function wantsTranscriptRangeEdit(message: string): boolean {
  return (
    /\b(cut|remove|delete|drop|trim|tighten|shorten)\b/i.test(message) &&
    /\b(this|that|selected|selection|transcript|phrase|sentence|pause|silence|range|part)\b/i.test(
      message,
    )
  );
}
