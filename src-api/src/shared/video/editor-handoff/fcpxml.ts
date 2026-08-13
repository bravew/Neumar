import { formatFcpTime } from './rational-time';
import type {
  EditorHandoffClip,
  EditorHandoffMediaRef,
  EditorHandoffModel,
} from './types';
import { escapeXmlText, xmlAttrs, xmlElement } from './xml';

export function writeFcpxml(model: EditorHandoffModel): string {
  const assets = model.mediaRefs
    .filter((ref) => !ref.missing)
    .map((ref) => assetXml(ref, model.fps))
    .join('\n    ');
  const primaryClips = primaryVisualClips(model).map((clip) =>
    assetClipXml(clip, model.fps),
  );
  const captions = captionClips(model).map((clip) => titleXml(clip, model.fps));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<fcpxml version="1.10">',
    '  <resources>',
    `    <format id="r-format" name="FFVideoFormat1080p${Math.round(model.fps)}" frameDuration="${formatFcpTime(1000 / model.fps, model.fps)}" width="1920" height="1080"/>`,
    assets ? `    ${assets}` : '',
    '  </resources>',
    `  <library><event${xmlAttrs({ name: model.projectName })}>`,
    `    <project${xmlAttrs({ name: model.projectName })}>`,
    `      <sequence format="r-format" duration="${formatFcpTime(model.durationMs, model.fps)}">`,
    '        <spine>',
    primaryClips.map((line) => `          ${line}`).join('\n'),
    captions.map((line) => `          ${line}`).join('\n'),
    '        </spine>',
    '      </sequence>',
    '    </project>',
    '  </event></library>',
    '</fcpxml>',
  ]
    .filter(Boolean)
    .join('\n');
}

function assetXml(ref: EditorHandoffMediaRef, fps: number): string {
  return xmlElement('asset', {
    id: assetRefId(ref.id),
    name: ref.id,
    src: ref.copiedPath ?? ref.path ?? ref.originalPathHint,
    start: '0s',
    duration: formatFcpTime(ref.metadata?.durationMs ?? 0, fps),
    hasVideo: ref.kind === 'video' || ref.kind === 'image' ? '1' : undefined,
    hasAudio: ref.kind === 'audio' || ref.kind === 'video' ? '1' : undefined,
  });
}

function assetClipXml(clip: EditorHandoffClip, fps: number): string {
  return xmlElement('asset-clip', {
    name: clip.name,
    ref: assetRefId(clip.mediaId ?? clip.id),
    offset: formatFcpTime(clip.startMs, fps),
    start: formatFcpTime(clip.sourceStartMs, fps),
    duration: formatFcpTime(clip.durationMs, fps),
  });
}

function titleXml(clip: EditorHandoffClip, fps: number): string {
  return `<title${xmlAttrs({
    name: clip.name,
    offset: formatFcpTime(clip.startMs, fps),
    duration: formatFcpTime(clip.durationMs, fps),
  })}><text><text-style ref="ts1">${escapeXmlText(clip.text)}</text-style></text></title>`;
}

function primaryVisualClips(model: EditorHandoffModel): EditorHandoffClip[] {
  return model.tracks
    .filter((track) => track.kind === 'video')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.kind === 'video' || clip.kind === 'image')
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function captionClips(model: EditorHandoffModel): EditorHandoffClip[] {
  return model.tracks
    .filter((track) => track.kind === 'caption')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.kind === 'caption' && Boolean(clip.text))
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function assetRefId(value: string): string {
  return `r-${value.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
