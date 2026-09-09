import { handoffRate, handoffTimebase, isNtscRate } from './handoff-rate';
import { msToFrames } from './rational-time';
import type {
  EditorHandoffClip,
  EditorHandoffMediaRef,
  EditorHandoffModel,
} from './types';
import { escapeXmlText, xmlElement } from './xml';

export function writePremiereXml(model: EditorHandoffModel): string {
  const rate = handoffRate(model);
  const clips = primaryVisualClips(model)
    .map((clip, index) => clipItemXml(model, clip, index + 1))
    .join('\n          ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmeml version="5">',
    '  <sequence>',
    `    <name>${escapeXmlText(model.projectName)}</name>`,
    `    <duration>${msToFrames(model.durationMs, rate)}</duration>`,
    // Premiere expresses NTSC as an integer timebase plus an ntsc flag; without
    // the flag a 30000/1001 project conforms as a true 30 and drifts.
    `    <rate><timebase>${handoffTimebase(rate)}</timebase><ntsc>${isNtscRate(rate) ? 'TRUE' : 'FALSE'}</ntsc></rate>`,
    '    <media><video><track>',
    `          ${clips}`,
    '    </track></video></media>',
    '  </sequence>',
    '</xmeml>',
  ].join('\n');
}

function clipItemXml(
  model: EditorHandoffModel,
  clip: EditorHandoffClip,
  index: number,
): string {
  const rate = handoffRate(model);
  const media = model.mediaRefs.find((ref) => ref.id === clip.mediaId);
  return xmlElement('clipitem', { id: `clipitem-${index}` }, [
    xmlElement('name', {}, escapeXmlText(clip.name)),
    xmlElement('start', {}, String(msToFrames(clip.startMs, rate))),
    xmlElement('end', {}, String(msToFrames(clip.endMs, rate))),
    xmlElement('in', {}, String(msToFrames(clip.sourceStartMs, rate))),
    xmlElement('out', {}, String(msToFrames(clip.sourceEndMs, rate))),
    fileXml(media, index),
  ]);
}

function fileXml(
  media: EditorHandoffMediaRef | undefined,
  index: number,
): string {
  return xmlElement('file', { id: `file-${index}` }, [
    xmlElement('name', {}, escapeXmlText(media?.id ?? `missing-${index}`)),
    xmlElement(
      'pathurl',
      {},
      escapeXmlText(
        media?.copiedPath ?? media?.path ?? media?.originalPathHint ?? '',
      ),
    ),
  ]);
}

function primaryVisualClips(model: EditorHandoffModel): EditorHandoffClip[] {
  return model.tracks
    .filter((track) => track.kind === 'video')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.kind === 'video' || clip.kind === 'image')
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}
