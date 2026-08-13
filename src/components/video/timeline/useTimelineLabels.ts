import { useMemo } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import {
  VIDEO_TRANSITION_REGISTRY,
  type VideoTransitionKind,
} from '@/shared/types/video';

/**
 * Build the static label objects passed into TimelineToolbar and TimelineTrack.
 * Memoized so the recipient components don't see new identity per parent render.
 * Extracted from Timeline.tsx to keep that component under the 350-line cap.
 */
export function useTimelineLabels() {
  const { t } = useLanguage();
  const toolbar = useMemo(
    () => ({
      play: t.video.editor.timeline.play,
      pause: t.video.editor.timeline.pause,
      seek: t.video.editor.timeline.seek,
      playhead: t.video.editor.timeline.playhead,
      zoomOut: t.video.editor.timeline.zoomOut,
      zoomIn: t.video.editor.timeline.zoomIn,
      zoomFit: t.video.editor.timeline.zoomFit,
      resetZoom: t.video.editor.timeline.resetZoom,
      addVideoLayer: t.video.editor.timeline.addVideoLayer,
      addTrack: t.video.editor.timeline.addTrack,
      trackKindVideo: t.video.editor.timeline.trackKind.video,
      trackKindBroll: t.video.editor.timeline.trackKind.broll,
      trackKindOverlay: t.video.editor.timeline.trackKind.overlay,
      trackKindAudioVo: t.video.editor.timeline.trackKind.audioVo,
      trackKindAudioMusic: t.video.editor.timeline.trackKind.audioMusic,
      trackKindAudioSfx: t.video.editor.timeline.trackKind.audioSfx,
      trackKindCaption: t.video.editor.timeline.trackKind.caption,
      trackKindVisualGroup: t.video.editor.timeline.trackKind.visualGroup,
      trackKindAudioGroup: t.video.editor.timeline.trackKind.audioGroup,
      trackKindOtherGroup: t.video.editor.timeline.trackKind.otherGroup,
      addCaption: t.video.editor.timeline.addCaption,
      toggleSnapping: t.video.editor.timeline.toggleSnapping,
      addMarker: t.video.editor.timeline.addMarker,
      selectTool: t.video.editor.timeline.selectTool,
      razorTool: t.video.editor.timeline.razorTool,
      splitClip: t.video.editor.timeline.splitClip,
    }),
    [t],
  );
  const track = useMemo(
    () => ({
      muted: t.video.editor.timeline.muted,
      audible: t.video.editor.timeline.audible,
      locked: t.video.editor.timeline.locked,
      unlocked: t.video.editor.timeline.unlocked,
      syncLocked: t.video.editor.timeline.syncLocked,
      syncUnlocked: t.video.editor.timeline.syncUnlocked,
      trimStart: t.video.editor.timeline.trimStart,
      trimEnd: t.video.editor.timeline.trimEnd,
      trackEmptyDropHint: t.video.editor.timeline.trackEmptyDropHint,
      moveLayerUp: t.video.editor.timeline.moveLayerUp,
      moveLayerDown: t.video.editor.timeline.moveLayerDown,
      renameTrack: t.video.editor.timeline.renameTrack,
      addClip: t.video.editor.timeline.addClip,
      contextMenu: t.video.editor.timeline.contextMenu,
      copyClip: t.video.editor.timeline.copyClip,
      duplicateClip: t.video.editor.timeline.duplicateClip,
      cutClip: t.video.editor.timeline.cutClip,
      splitClip: t.video.editor.timeline.splitClip,
      deleteClip: t.video.editor.timeline.deleteClip,
      rippleDeleteClip: t.video.editor.timeline.rippleDeleteClip,
      muteTrack: t.video.editor.timeline.muteTrack,
      unmuteTrack: t.video.editor.timeline.unmuteTrack,
      lockTrack: t.video.editor.timeline.lockTrack,
      unlockTrack: t.video.editor.timeline.unlockTrack,
      syncLockTrack: t.video.editor.timeline.syncLockTrack,
      unsyncLockTrack: t.video.editor.timeline.unsyncLockTrack,
      resizeTrack: t.video.editor.timeline.resizeTrack,
      showTrack: t.video.editor.timeline.showTrack,
      hideTrack: t.video.editor.timeline.hideTrack,
      deleteTrack: t.video.editor.timeline.deleteTrack,
      linkedClip: t.video.editor.timeline.linkedClip,
      keyframedClip: t.video.editor.timeline.keyframedClip,
      captionGroup: t.video.editor.timeline.captionGroup,
      audioMutedClip: t.video.editor.timeline.audioMutedClip,
      audioGainClip: t.video.editor.timeline.audioGainClip,
      audioFadeClip: t.video.editor.timeline.audioFadeClip,
      audioTransitionClip: t.video.editor.timeline.audioTransitionClip,
      audioFadeInHandle: t.video.editor.timeline.audioFadeInHandle,
      audioFadeOutHandle: t.video.editor.timeline.audioFadeOutHandle,
      keyboardMoveHint: t.video.editor.timeline.keyboardMoveHint,
      keyboardMoveAnnouncement:
        t.video.editor.timeline.keyboardMoveAnnouncement,
      resyncGroup: t.video.editor.timeline.resyncGroup,
      unlinkGroup: t.video.editor.timeline.unlinkGroup,
      aiEditClip: t.video.editor.timeline.aiEditClip,
      aiGenerateMusic: t.video.editor.timeline.aiGenerateMusic,
      aiSetKeyframes: t.video.editor.timeline.aiSetKeyframes,
      syncLockBlocked: t.video.editor.timeline.syncLockBlocked,
      outOfSyncGroup: t.video.editor.timeline.outOfSyncGroup,
      clearWarning: t.video.editor.timeline.clearWarning,
      transitionNames: transitionNames(t.video.storyboard.transitions),
      transitionDropHere: t.video.editor.transitionRail.dropHere,
      transitionBadgeAriaLabel: t.video.editor.transitionRail.badgeAriaLabel,
      transitionDropNoAdjacent: t.video.editor.transitionRail.dropNoAdjacent,
      transitionDropGap: t.video.editor.transitionRail.dropGap,
      transitionDropLocked: t.video.editor.transitionRail.dropLocked,
      transitionDropTooShort: t.video.editor.transitionRail.dropTooShort,
      transitionResize: t.video.editor.transitionRail.resizeTransition,
      trackRole: t.video.editor.timeline.trackRole,
      trackZone: t.video.editor.timeline.trackZone,
    }),
    [t],
  );
  const marker = useMemo(
    () => ({
      label: t.video.editor.timeline.markerLabel,
      timeMs: t.video.editor.timeline.markerTimeMs,
      color: t.video.editor.timeline.markerColor,
      chapter: t.video.editor.timeline.markerChapter,
      comment: t.video.editor.timeline.markerComment,
      delete: t.video.editor.timeline.deleteMarker,
      close: t.video.editor.timeline.closeMarker,
    }),
    [t],
  );
  return { toolbar, track, marker };
}

function transitionNames(
  messages: Record<string, string>,
): Record<VideoTransitionKind, string> {
  return Object.fromEntries(
    VIDEO_TRANSITION_REGISTRY.map((entry) => [
      entry.kind,
      messages[entry.labelKey.replace('transitions.', '')] ?? entry.kind,
    ]),
  ) as Record<VideoTransitionKind, string>;
}
