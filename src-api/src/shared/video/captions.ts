import { getProject, writeProject } from './store';
import type {
  Subtitle,
  SubtitleStyle,
  SubtitleWord,
  VideoProject,
} from './types';

export interface CaptionSyncInput {
  sourceId?: string;
  cutPlanId?: string;
  style?: SubtitleStyle;
  regenerate?: boolean;
}

export async function transcribeAsset(
  projectId: string,
  assetId: string,
  engine = 'auto-subs',
): Promise<{ project: VideoProject; subtitles: Subtitle[] }> {
  const project = await getProject(projectId);
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset) throw new Error('Asset not found');
  const durationMs = Math.max(asset.metadata.durationMs || 3000, 1000);
  const text = project.script || project.prompt || asset.path;
  const subtitles = wordsToSubtitles(text, durationMs, {
    engine,
    sourceMediaId: asset.id,
  });
  const next = {
    ...project,
    assets: project.assets.map((item) =>
      item.id === assetId
        ? { ...item, metadata: { ...item.metadata, subtitles } }
        : item,
    ),
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return { project: next, subtitles };
}

export async function syncCaptions(
  projectId: string,
  input: CaptionSyncInput,
): Promise<{ project: VideoProject; subtitles: Subtitle[] }> {
  const project = await getProject(projectId);
  const storyboard = project.storyboard;
  if (!storyboard) throw new Error('Storyboard not found');
  let cursor = 0;
  const subtitles = storyboard.scenes.flatMap((scene) => {
    const text = scene.caption?.text || scene.intent;
    const startMs = cursor;
    cursor += scene.durationMs;
    return [
      {
        id: crypto.randomUUID(),
        text,
        startMs,
        endMs: cursor,
        style: input.style ?? scene.caption?.style,
        sourceAnchors: [
          {
            sourceMediaId: input.sourceId ?? scene.id,
            sourceElementId: scene.id,
            sourceStartMs: 0,
            sourceEndMs: scene.durationMs,
          },
        ],
      },
    ];
  });
  const next = {
    ...project,
    scenes: (project.scenes ?? []).map((scene) => ({
      ...scene,
      subtitles: subtitles.filter(
        (subtitle) => subtitle.sourceAnchors?.[0]?.sourceElementId === scene.id,
      ),
    })),
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return { project: next, subtitles };
}

export async function patchCaption(
  projectId: string,
  captionId: string,
  patch: Partial<Subtitle>,
): Promise<{ project: VideoProject; subtitle?: Subtitle }> {
  const project = await getProject(projectId);
  let updated: Subtitle | undefined;
  const next = {
    ...project,
    scenes: (project.scenes ?? []).map((scene) => ({
      ...scene,
      subtitles: (scene.subtitles ?? []).map((subtitle) => {
        if (subtitle.id !== captionId) return subtitle;
        updated = {
          ...subtitle,
          ...snapCaptionPatchToWords(subtitle, patch),
          manuallyEdited: true,
        };
        return updated;
      }),
    })),
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return { project: next, subtitle: updated };
}

export async function splitCaption(
  projectId: string,
  captionId: string,
  wordIndex: number,
): Promise<{ project: VideoProject; subtitles: Subtitle[] }> {
  const project = await getProject(projectId);
  const created: Subtitle[] = [];
  const next = {
    ...project,
    scenes: (project.scenes ?? []).map((scene) => ({
      ...scene,
      subtitles: (scene.subtitles ?? []).flatMap((subtitle) => {
        if (subtitle.id !== captionId) return [subtitle];
        const words = subtitle.text.split(/\s+/);
        const left = words.slice(0, wordIndex).join(' ') || subtitle.text;
        const right = words.slice(wordIndex).join(' ');
        if (!right) return [subtitle];
        const mid = Math.round((subtitle.startMs + subtitle.endMs) / 2);
        const parts: Subtitle[] = [
          { ...subtitle, text: left, endMs: mid, manuallyEdited: true },
          {
            ...subtitle,
            id: crypto.randomUUID(),
            text: right,
            startMs: mid,
            manuallyEdited: true,
          },
        ];
        created.push(...parts);
        return parts;
      }),
    })),
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return { project: next, subtitles: created };
}

export async function mergeCaption(
  projectId: string,
  captionId: string,
): Promise<{ project: VideoProject }> {
  const project = await getProject(projectId);
  const next = {
    ...project,
    scenes: (project.scenes ?? []).map((scene) => {
      const subtitles = [...(scene.subtitles ?? [])];
      const index = subtitles.findIndex(
        (subtitle) => subtitle.id === captionId,
      );
      if (index <= 0) return scene;
      const previous = subtitles[index - 1]!;
      const current = subtitles[index]!;
      subtitles.splice(index - 1, 2, {
        ...previous,
        text: `${previous.text} ${current.text}`.trim(),
        endMs: current.endMs,
        manuallyEdited: true,
      });
      return { ...scene, subtitles };
    }),
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return { project: next };
}

function snapCaptionPatchToWords(
  subtitle: Subtitle,
  patch: Partial<Subtitle>,
): Partial<Subtitle> {
  if (!subtitle.words?.length) return patch;

  const next = { ...patch };
  if (typeof patch.startMs === 'number') {
    next.startMs = nearestWordStart(subtitle.words, patch.startMs);
  }
  if (typeof patch.endMs === 'number') {
    next.endMs = nearestWordEnd(subtitle.words, patch.endMs);
  }

  const startMs = next.startMs ?? subtitle.startMs;
  if (typeof next.endMs === 'number' && next.endMs <= startMs) {
    next.endMs =
      subtitle.words.find((word) => word.endMs > startMs)?.endMs ??
      Math.max(subtitle.endMs, startMs + 1);
  }

  return next;
}

function nearestWordStart(words: SubtitleWord[], valueMs: number): number {
  return nearestBoundary(
    words.map((word) => word.startMs),
    valueMs,
  );
}

function nearestWordEnd(words: SubtitleWord[], valueMs: number): number {
  return nearestBoundary(
    words.map((word) => word.endMs),
    valueMs,
  );
}

function nearestBoundary(boundaries: number[], valueMs: number): number {
  return boundaries.reduce((nearest, boundary) =>
    Math.abs(boundary - valueMs) < Math.abs(nearest - valueMs)
      ? boundary
      : nearest,
  );
}

function wordsToSubtitles(
  text: string,
  durationMs: number,
  source: { engine: string; sourceMediaId: string },
): Subtitle[] {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks = sentences.length ? sentences : [text.trim() || 'Transcript'];
  const perChunk = Math.max(500, Math.floor(durationMs / chunks.length));
  return chunks.map((chunk, index) => ({
    id: crypto.randomUUID(),
    text: chunk,
    startMs: index * perChunk,
    endMs: index === chunks.length - 1 ? durationMs : (index + 1) * perChunk,
    words: chunk.split(/\s+/).map((word, wordIndex) => ({
      text: word,
      startMs: index * perChunk + wordIndex * 250,
      endMs: index * perChunk + wordIndex * 250 + 200,
    })),
    sourceAnchors: [
      {
        sourceMediaId: source.sourceMediaId,
        sourceElementId: source.engine,
        sourceStartMs: index * perChunk,
        sourceEndMs:
          index === chunks.length - 1 ? durationMs : (index + 1) * perChunk,
      },
    ],
  }));
}
