import fs from 'node:fs/promises';

import type { Subtitle } from './types';

export async function renderCaptionOverlay(
  style: 'tiktok-word' | 'hormozi-bold' | 'classic' | 'karaoke',
  subtitles: Subtitle[],
  durationMs: number,
  outPath: string,
): Promise<void> {
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        renderer: 'ffmpeg-ass-fallback',
        style,
        durationMs,
        subtitles,
      },
      null,
      2,
    ),
  );
}

export function subtitlesToAss(subtitles: Subtitle[]): string {
  const events = subtitles.map((subtitle) => {
    return `Dialogue: 0,${assTime(subtitle.startMs)},${assTime(subtitle.endMs)},Default,,0,0,0,,${escapeAss(subtitle.text)}`;
  });
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, Alignment',
    'Style: Default,Arial,48,&H00FFFFFF,2',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

function assTime(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((totalSeconds % 1) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function escapeAss(text: string): string {
  return text.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}
