import { useCallback, useMemo, useState, type MouseEvent } from 'react';

import {
  ArrowDown,
  ArrowUp,
  Copy,
  CopyPlus,
  ListRestart,
  Lock,
  RefreshCw,
  Scissors,
  Shield,
  ShieldOff,
  Trash2,
  Unlock,
  Unlink,
  Volume2,
  VolumeX,
} from 'lucide-react';

import {
  isVisualTimelineTrack,
  type VideoAgentToolCallInput,
  type VideoTimelineClip,
  type VideoTimelineTrack,
} from '@/shared/types/video';

import {
  TimelineActionMenu,
  type TimelineActionMenuItem,
  type TimelineActionMenuPoint,
} from './TimelineActionMenu';
import { timelineAiClipMenuItems } from './timelineAiMenuItems';
import type { TimelineTrackLabels } from './TimelineLabels';
import { useTimelineClipboard } from './useTimelineClipboard';
import { useTimelineEditorStore } from './useTimelineEditorStore';

interface UseTimelineTrackContextMenuOptions {
  clips: VideoTimelineClip[];
  labels: TimelineTrackLabels;
  onSelectClip: (clip: VideoTimelineClip) => void;
  onSelectTrack: (trackId: string) => void;
  onToggleTrackMute: (track: VideoTimelineTrack) => void;
  onToggleTrackLock: (track: VideoTimelineTrack) => void;
  onToggleTrackSyncLock: (track: VideoTimelineTrack) => void;
  onMoveTrackLayer: (trackId: string, direction: 'up' | 'down') => void;
  onDeleteSelectedClip: (options?: { ripple?: boolean }) => void;
  onApplyAgentTool?: (
    input: VideoAgentToolCallInput,
  ) => Promise<unknown> | unknown;
  playheadMs: number;
  selectedClipIds: Set<string>;
  track: VideoTimelineTrack;
}

type TimelineTrackContextMenu =
  | { kind: 'clip'; clipId: string; point: TimelineActionMenuPoint }
  | { kind: 'track'; point: TimelineActionMenuPoint };

export function useTimelineTrackContextMenu({
  clips,
  labels,
  onMoveTrackLayer,
  onSelectClip,
  onSelectTrack,
  onToggleTrackLock,
  onToggleTrackMute,
  onToggleTrackSyncLock,
  onApplyAgentTool,
  onDeleteSelectedClip,
  playheadMs,
  selectedClipIds,
  track,
}: UseTimelineTrackContextMenuOptions) {
  const [contextMenu, setContextMenu] =
    useState<TimelineTrackContextMenu | null>(null);
  const { copy, cut } = useTimelineClipboard({ playheadMs });
  const splitSelectedClipAtPlayhead = useTimelineEditorStore(
    (state) => state.splitSelectedClipAtPlayhead,
  );
  const duplicateSelectedClips = useTimelineEditorStore(
    (state) => state.duplicateSelectedClips,
  );
  const resyncLinkGroup = useTimelineEditorStore(
    (state) => state.resyncLinkGroup,
  );
  const unlinkLinkGroup = useTimelineEditorStore(
    (state) => state.unlinkLinkGroup,
  );
  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const clip = findContextMenuClip(event, clips);
      if (clip) {
        if (!selectedClipIds.has(clip.id)) onSelectClip(clip);
        setContextMenu({
          kind: 'clip',
          clipId: clip.id,
          point: eventPoint(event),
        });
        return;
      }
      onSelectTrack(track.id);
      setContextMenu({ kind: 'track', point: eventPoint(event) });
    },
    [clips, onSelectClip, onSelectTrack, selectedClipIds, track.id],
  );
  const items = useMemo<TimelineActionMenuItem[]>(() => {
    if (!contextMenu) return [];
    if (contextMenu.kind === 'clip') {
      const clip =
        clips.find((item) => item.id === contextMenu.clipId) ?? clips[0];
      return [
        {
          id: 'copy',
          label: labels.copyClip,
          icon: Copy,
          onSelect: () => void copy(),
        },
        {
          id: 'duplicate',
          label: labels.duplicateClip,
          icon: CopyPlus,
          disabled: track.locked,
          onSelect: () => duplicateSelectedClips(),
        },
        {
          id: 'cut',
          label: labels.cutClip,
          icon: Scissors,
          disabled: track.locked,
          onSelect: () => void cut(),
        },
        {
          id: 'split',
          label: labels.splitClip,
          icon: Scissors,
          disabled: track.locked,
          onSelect: () => splitSelectedClipAtPlayhead(playheadMs),
        },
        {
          id: 'delete',
          label: labels.deleteClip,
          icon: Trash2,
          disabled: track.locked,
          danger: true,
          onSelect: () => onDeleteSelectedClip(),
        },
        {
          id: 'ripple-delete',
          label: labels.rippleDeleteClip,
          icon: ListRestart,
          disabled: track.locked,
          danger: true,
          onSelect: () => onDeleteSelectedClip({ ripple: true }),
        },
        ...(clip?.linkGroupId
          ? [
              {
                id: 'resync-group',
                label: labels.resyncGroup,
                icon: RefreshCw,
                disabled: track.locked,
                onSelect: () => resyncLinkGroup(clip.linkGroupId!),
              },
              {
                id: 'unlink-group',
                label: labels.unlinkGroup,
                icon: Unlink,
                disabled: track.locked,
                onSelect: () => unlinkLinkGroup(clip.linkGroupId!),
              },
            ]
          : []),
        ...(clip
          ? timelineAiClipMenuItems({
              clip,
              labels,
              onApplyAgentTool,
              track,
            })
          : []),
      ];
    }
    return trackMenuItems({
      labels,
      onMoveTrackLayer,
      onToggleTrackLock,
      onToggleTrackMute,
      onToggleTrackSyncLock,
      track,
    });
  }, [
    clips,
    contextMenu,
    copy,
    cut,
    duplicateSelectedClips,
    labels,
    onApplyAgentTool,
    onDeleteSelectedClip,
    onMoveTrackLayer,
    onToggleTrackLock,
    onToggleTrackMute,
    onToggleTrackSyncLock,
    playheadMs,
    resyncLinkGroup,
    splitSelectedClipAtPlayhead,
    track,
    unlinkLinkGroup,
  ]);

  return {
    menu: (
      <TimelineActionMenu
        label={labels.contextMenu}
        point={contextMenu?.point ?? null}
        items={items}
        onClose={() => setContextMenu(null)}
      />
    ),
    onContextMenu,
  };
}

function trackMenuItems({
  labels,
  onMoveTrackLayer,
  onToggleTrackLock,
  onToggleTrackMute,
  onToggleTrackSyncLock,
  track,
}: {
  labels: TimelineTrackLabels;
  onMoveTrackLayer: (trackId: string, direction: 'up' | 'down') => void;
  onToggleTrackMute: (track: VideoTimelineTrack) => void;
  onToggleTrackLock: (track: VideoTimelineTrack) => void;
  onToggleTrackSyncLock: (track: VideoTimelineTrack) => void;
  track: VideoTimelineTrack;
}): TimelineActionMenuItem[] {
  const items: TimelineActionMenuItem[] = [
    {
      id: 'mute-track',
      label: track.muted ? labels.unmuteTrack : labels.muteTrack,
      icon: track.muted ? Volume2 : VolumeX,
      onSelect: () => onToggleTrackMute(track),
    },
    {
      id: 'lock-track',
      label: track.locked ? labels.unlockTrack : labels.lockTrack,
      icon: track.locked ? Unlock : Lock,
      onSelect: () => onToggleTrackLock(track),
    },
    {
      id: 'sync-lock-track',
      label: track.syncLocked ? labels.unsyncLockTrack : labels.syncLockTrack,
      icon: track.syncLocked ? ShieldOff : Shield,
      onSelect: () => onToggleTrackSyncLock(track),
    },
  ];
  if (!isVisualTimelineTrack(track)) return items;
  return [
    ...items,
    {
      id: 'move-layer-up',
      label: labels.moveLayerUp,
      icon: ArrowUp,
      onSelect: () => onMoveTrackLayer(track.id, 'up'),
    },
    {
      id: 'move-layer-down',
      label: labels.moveLayerDown,
      icon: ArrowDown,
      onSelect: () => onMoveTrackLayer(track.id, 'down'),
    },
  ];
}

function findContextMenuClip(
  event: MouseEvent,
  clips: VideoTimelineClip[],
): VideoTimelineClip | undefined {
  const target = event.target;
  const clipNode =
    target instanceof HTMLElement
      ? target.closest<HTMLElement>('[data-timeline-clip-id]')
      : null;
  return clips.find((item) => item.id === clipNode?.dataset.timelineClipId);
}

function eventPoint(event: MouseEvent): TimelineActionMenuPoint {
  return { x: event.clientX, y: event.clientY };
}
