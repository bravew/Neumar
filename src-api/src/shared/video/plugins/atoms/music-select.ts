import {
  generateBackgroundMusic,
  type MusicRequest,
} from '@/shared/video/music';
import { getProject, updateProjectDocument } from '@/shared/video/store';
import { rebuildTimelineFromStoryboard } from '@/shared/video/timeline';
import type {
  MediaItem,
  MusicPlan,
  Storyboard,
  VideoProject,
} from '@/shared/video/types';

export interface MusicSelectionInput {
  prompt?: string;
  mood?: string;
  tempoBpm?: number;
  durationMs?: number;
  generateIfMissing?: boolean;
  provider?: MusicRequest['provider'];
  model?: string;
  seed?: number;
}

export interface MusicSelectionPlan {
  prompt: string;
  mood: string;
  tempoBpm: number;
  durationMs: number;
  ducking: {
    underTrackKind: 'audio-vo';
    attenuationDb: number;
    fadeMs: number;
  };
}

export interface MusicSelectionResult {
  project: VideoProject;
  plan: MusicSelectionPlan;
  asset?: MediaItem;
  reused: boolean;
  generated: boolean;
  costCents: number;
}

const MOOD_RULES: Array<{
  mood: string;
  bpm: number;
  pattern: RegExp;
}> = [
  {
    mood: 'urgent cinematic pulse',
    bpm: 126,
    pattern: /\b(urgent|breaking|launch|race|sports|hype|fast)\b/i,
  },
  {
    mood: 'warm optimistic acoustic',
    bpm: 96,
    pattern: /\b(warm|human|family|community|recap|celebrate|uplift)\b/i,
  },
  {
    mood: 'focused modern synth',
    bpm: 104,
    pattern:
      /\b(product|demo|tutorial|workflow|dashboard|business|saas|tech)\b/i,
  },
  {
    mood: 'calm ambient bed',
    bpm: 78,
    pattern: /\b(calm|quiet|reflect|memorial|wellness|nature|slow)\b/i,
  },
  {
    mood: 'documentary underscore',
    bpm: 88,
    pattern: /\b(explainer|documentary|history|research|news|analysis)\b/i,
  },
];

export function inferMusicSelectionPlan(
  project: Pick<VideoProject, 'prompt' | 'name' | 'storyboard'>,
  input: MusicSelectionInput = {},
): MusicSelectionPlan {
  const storyboard = project.storyboard;
  const sourceText = [
    input.prompt,
    input.mood,
    storyboard?.intent,
    storyboard?.scenes
      .map((scene) => `${scene.intent} ${scene.caption?.text ?? ''}`)
      .join(' '),
    project.prompt,
    project.name,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const moodHint = input.mood?.trim();
  const matched =
    (moodHint
      ? MOOD_RULES.find((rule) => rule.pattern.test(moodHint))
      : undefined) ?? MOOD_RULES.find((rule) => rule.pattern.test(sourceText));
  const durationMs =
    input.durationMs ??
    storyboard?.totalDurationMs ??
    storyboardDurationMs(storyboard) ??
    30_000;
  const mood = moodHint || matched?.mood || 'balanced editorial bed';
  const tempoBpm =
    input.tempoBpm ?? matched?.bpm ?? tempoFromDuration(durationMs);
  return {
    prompt: input.prompt?.trim() || `Instrumental ${mood} for ${project.name}`,
    mood,
    tempoBpm,
    durationMs,
    ducking: {
      underTrackKind: 'audio-vo',
      attenuationDb: -10,
      fadeMs: 250,
    },
  };
}

export function findReusableMusicAsset(
  project: Pick<VideoProject, 'assets'>,
  plan: Pick<MusicSelectionPlan, 'mood' | 'durationMs' | 'tempoBpm'>,
): MediaItem | undefined {
  return project.assets
    .filter((asset) => asset.kind === 'audio' && asset.source === 'music')
    .map((asset) => ({ asset, score: scoreMusicAsset(asset, plan) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.asset;
}

export async function selectBackgroundMusic(
  projectId: string,
  input: MusicSelectionInput = {},
): Promise<MusicSelectionResult> {
  const project = await getProject(projectId);
  const plan = inferMusicSelectionPlan(project, input);
  const reusable = findReusableMusicAsset(project, plan);
  if (reusable) {
    const updated = await updateProjectDocument(projectId, (current) =>
      rebuildTimelineFromStoryboard({
        ...current,
        storyboard: upsertStoryboardMusic(current.storyboard, {
          prompt: plan.prompt,
          mood: plan.mood,
          durationMs: plan.durationMs,
          tempoBpm: plan.tempoBpm,
          provider: input.provider,
          model: input.model,
          seed: input.seed,
          assetId: reusable.id,
        }),
        updatedAt: new Date().toISOString(),
      }),
    );
    return {
      project: updated,
      plan,
      asset: reusable,
      reused: true,
      generated: false,
      costCents: 0,
    };
  }

  if (!input.generateIfMissing) {
    return { project, plan, reused: false, generated: false, costCents: 0 };
  }

  const generated = await generateBackgroundMusic(projectId, {
    prompt: plan.prompt,
    mood: plan.mood,
    tempoBpm: plan.tempoBpm,
    durationMs: plan.durationMs,
    provider: input.provider,
    model: input.model,
    seed: input.seed,
  });
  return {
    project: generated.project,
    plan,
    asset: generated.asset,
    reused: false,
    generated: true,
    costCents: generated.costCents,
  };
}

function scoreMusicAsset(
  asset: MediaItem,
  plan: Pick<MusicSelectionPlan, 'mood' | 'durationMs' | 'tempoBpm'>,
): number {
  const duration = asset.metadata.durationMs;
  if (duration < Math.max(1000, plan.durationMs * 0.5)) return 0;
  const prompt = asset.provenance?.prompt?.toLowerCase() ?? '';
  const moodWords = new Set(
    plan.mood.toLowerCase().split(/\W+/).filter(Boolean),
  );
  const moodScore =
    [...moodWords].filter((word) => prompt.includes(word)).length * 10;
  const durationScore = Math.max(
    0,
    20 - Math.abs(duration - plan.durationMs) / 1000,
  );
  return (
    1 + moodScore + durationScore + (asset.provenance?.fallbackReason ? -10 : 0)
  );
}

function storyboardDurationMs(
  storyboard: Storyboard | undefined,
): number | undefined {
  const total = storyboard?.scenes.reduce(
    (sum, scene) => sum + scene.durationMs,
    0,
  );
  return total && total > 0 ? total : undefined;
}

function tempoFromDuration(durationMs: number): number {
  if (durationMs <= 15_000) return 120;
  if (durationMs <= 45_000) return 100;
  return 84;
}

function upsertStoryboardMusic(
  storyboard: Storyboard | undefined,
  music: MusicPlan,
): Storyboard | undefined {
  return storyboard ? { ...storyboard, music } : storyboard;
}
