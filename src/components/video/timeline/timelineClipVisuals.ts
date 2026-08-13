import { Captions, Image, Layers, Music, Video, Volume2 } from 'lucide-react';

import type {
  VideoMediaItem,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

export function getTimelineClipClass(track: VideoTimelineTrack): string {
  if (track.kind === 'caption') {
    return 'border-amber-300/70 bg-amber-100 text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/20 dark:text-amber-100';
  }
  if (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  ) {
    return 'border-blue-300/70 bg-blue-100 text-blue-950 dark:border-blue-400/30 dark:bg-blue-400/20 dark:text-blue-100';
  }
  if (track.kind === 'broll' || track.kind === 'overlay') {
    return 'border-violet-300/70 bg-violet-100 text-violet-950 dark:border-violet-400/30 dark:bg-violet-400/20 dark:text-violet-100';
  }
  return 'border-emerald-300/70 bg-emerald-100 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-400/20 dark:text-emerald-100';
}

export function getTimelineClipIcon(
  clip: VideoTimelineClip,
  track: VideoTimelineTrack,
) {
  if (clip.kind === 'caption') return Captions;
  if (clip.kind === 'audio') {
    return track.kind === 'audio-music' ? Music : Volume2;
  }
  if (clip.kind === 'image') return Image;
  if (clip.kind === 'overlay') return Layers;
  return Video;
}

export function getTimelineClipLabel(
  clip: VideoTimelineClip,
  asset?: VideoMediaItem,
): string {
  if (clip.kind === 'caption') return clip.text;
  const assetName = assetDisplayName(asset);
  if (clip.kind === 'audio') {
    const label = clip.transcriptText ?? clip.name;
    if (isGeneratedAssetLabel(label) && assetName) return assetName;
    return label ?? assetName ?? clip.id;
  }
  if (isGeneratedAssetLabel(clip.name) && assetName) return assetName;
  return clip.name ?? assetName ?? clip.sceneId ?? clip.id;
}

function assetDisplayName(asset?: VideoMediaItem): string | undefined {
  const displayName = asset?.provenance?.sourceDisplayName?.trim();
  if (!displayName) return undefined;
  const index = Math.max(
    displayName.lastIndexOf('/'),
    displayName.lastIndexOf('\\'),
  );
  return index >= 0 ? displayName.slice(index + 1) : displayName;
}

function isGeneratedAssetLabel(label: string | undefined): boolean {
  if (!label) return true;
  return label.startsWith('catalog:') || label.startsWith('catalog-');
}
