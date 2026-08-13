import type { VideoTransitionKind } from '@/shared/types/video';

export interface TimelineClipLabels {
  trimStart: string;
  trimEnd: string;
  linkedClip: string;
  keyframedClip: string;
  captionGroup: string;
  audioMutedClip: string;
  audioGainClip: string;
  audioFadeClip: string;
  audioTransitionClip: string;
  audioFadeInHandle: string;
  audioFadeOutHandle: string;
  keyboardMoveHint: string;
  keyboardMoveAnnouncement: string;
}

export interface TimelineTrackLabels extends TimelineClipLabels {
  muted: string;
  audible: string;
  locked: string;
  unlocked: string;
  syncLocked: string;
  syncUnlocked: string;
  trackEmptyDropHint: string;
  moveLayerUp: string;
  moveLayerDown: string;
  renameTrack: string;
  addClip: string;
  contextMenu: string;
  copyClip: string;
  duplicateClip: string;
  cutClip: string;
  splitClip: string;
  deleteClip: string;
  rippleDeleteClip: string;
  muteTrack: string;
  unmuteTrack: string;
  lockTrack: string;
  unlockTrack: string;
  syncLockTrack: string;
  unsyncLockTrack: string;
  resizeTrack: string;
  showTrack: string;
  hideTrack: string;
  deleteTrack: string;
  resyncGroup: string;
  unlinkGroup: string;
  aiEditClip: string;
  aiGenerateMusic: string;
  aiSetKeyframes: string;
  syncLockBlocked: string;
  outOfSyncGroup: string;
  clearWarning: string;
  transitionNames: Record<VideoTransitionKind, string>;
  transitionDropHere: string;
  transitionBadgeAriaLabel: string;
  transitionDropNoAdjacent: string;
  transitionDropGap: string;
  transitionDropLocked: string;
  transitionDropTooShort: string;
  transitionResize: string;
  trackRole: {
    primary: string;
    broll: string;
    overlay: string;
    voice: string;
    music: string;
    sfx: string;
    captions: string;
  };
  trackZone: {
    visual: string;
    audio: string;
    caption: string;
  };
}
