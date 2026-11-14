import { describe, expect, it } from 'vitest';

import {
  buildCaptionSidecarSrt,
  captionSrtByLanguage,
} from '@/shared/video/pipeline';
import type { CaptionTimelineClip, VideoProject } from '@/shared/video/types';

const START_MS = 1200;
const DURATION_MS = 1800;
const TIMING_LINE = '00:00:01,200 --> 00:00:03,000';

// Fifteen Chinese characters, so a 32-wide line ends between 程 and 序.
const PREFIX = '我们今天下班前花五分钟想想汇报';
const CHINESE_CUE = `${PREFIX}程序崩溃`;

describe('caption export wrapping', () => {
  it('wraps an exported caption on a Chinese word boundary without changing cue text or timing', () => {
    const srt = buildCaptionSidecarSrt(captionProject(CHINESE_CUE));

    expect(srt).toBe(`1\n${TIMING_LINE}\n${PREFIX}\n程序崩溃\n`);
    expect(cueLines(srt).join('')).toBe(CHINESE_CUE);
  });

  it('breaks at a space instead of inside a Latin word and drops no characters', () => {
    const text = '每天下班前花五分钟想想汇报 Transformer 模型';

    const srt = buildCaptionSidecarSrt(captionProject(text));

    expect(cueLines(srt)).toEqual([
      '每天下班前花五分钟想想汇报',
      'Transformer 模型',
    ]);
    expect(withoutSpaces(cueLines(srt).join(''))).toBe(withoutSpaces(text));
    expect(srt).toContain(TIMING_LINE);
  });

  it('keeps a glued Latin run together next to Chinese text', () => {
    const text = '每天下班前花五分钟想想汇报修GPT-4o模型';

    const srt = buildCaptionSidecarSrt(captionProject(text));

    expect(cueLines(srt)).toEqual([
      '每天下班前花五分钟想想汇报修',
      'GPT-4o模型',
    ]);
    expect(cueLines(srt).join('')).toBe(text);
  });

  it('wraps each language sidecar on its own boundaries and keeps one cue per sidecar', () => {
    const project = captionProject(CHINESE_CUE);
    const primary = project.timeline!.tracks[0]!;
    if (primary.kind !== 'caption') throw new Error('expected caption track');
    primary.language = 'zh';
    project.timeline!.tracks.push({
      ...primary,
      id: 'track-caption-en',
      name: 'Captions (en)',
      language: 'en',
      order: 31,
      clips: [
        captionClip(
          'one two three four five six seven eight nine ten',
          'clip-en',
        ),
      ],
    });

    const byLanguage = captionSrtByLanguage(project);

    expect(byLanguage.get('zh')).toBe(
      `1\n${TIMING_LINE}\n${PREFIX}\n程序崩溃\n`,
    );
    expect(byLanguage.get('en')).toBe(
      `1\n${TIMING_LINE}\none two three four five six\nseven eight nine ten\n`,
    );
  });

  it('leaves a cue that already fits one line unchanged', () => {
    expect(buildCaptionSidecarSrt(captionProject('代码审查'))).toBe(
      `1\n${TIMING_LINE}\n代码审查\n`,
    );
  });

  it('keeps an explicit line break and never emits a blank line inside a cue', () => {
    const srt = buildCaptionSidecarSrt(captionProject('第一行\n\n第二行'));

    expect(srt).toBe(`1\n${TIMING_LINE}\n第一行\n第二行\n`);
  });

  it('keeps a whitespace-only interior line from ending the cue', () => {
    const text = 'X\n   \nY';

    const srt = buildCaptionSidecarSrt(captionProject(text));

    expect(srt).toBe(`1\n${TIMING_LINE}\n${text}\n`);
    expect(cueLines(srt)).toEqual(['X', '   ', 'Y']);
  });

  it('keeps a tab-only interior line from ending the cue', () => {
    const text = 'X\n\t\t\nY';

    const srt = buildCaptionSidecarSrt(captionProject(text));

    expect(srt).toBe(`1\n${TIMING_LINE}\n${text}\n`);
    expect(cueLines(srt)).toEqual(['X', '\t\t', 'Y']);
  });
});

function cueLines(srt: string | undefined): string[] {
  expect(srt).toBeTruthy();
  const blocks = srt!.trim().split('\n\n');
  expect(blocks).toHaveLength(1);
  return blocks[0]!.split('\n').slice(2);
}

function withoutSpaces(text: string): string {
  return text.replace(/\s+/g, '');
}

function captionProject(text: string): VideoProject {
  return {
    revision: 1,
    id: 'project-1',
    name: 'Caption export wrap',
    template: 'explainer',
    prompt: 'Caption export wrap',
    assets: [],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    scenes: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 5000,
      fps: 30,
      tracks: [
        {
          id: 'track-caption-main',
          kind: 'caption',
          name: 'Captions',
          muted: false,
          locked: false,
          order: 30,
          clips: [captionClip(text, 'clip-caption-1')],
        },
      ],
    },
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}

function captionClip(text: string, id: string): CaptionTimelineClip {
  return {
    id,
    kind: 'caption',
    name: 'Caption',
    sourceRef: { kind: 'scene', sceneId: 'scene-1' },
    sceneId: 'scene-1',
    startMs: START_MS,
    durationMs: DURATION_MS,
    trimStartMs: 0,
    trimEndMs: DURATION_MS,
    text,
  };
}
