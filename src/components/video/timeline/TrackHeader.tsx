import { useEffect, useState, useRef } from 'react';

import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Shield,
  ShieldOff,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import {
  isVisualTimelineTrack,
  type VideoTimelineTrack,
} from '@/shared/types/video';

import {
  fileAcceptForTrack,
  getTrackIcon,
  trackAcceptsClipUpload,
  trackHasAudio,
  trackSupportsLayerOrder,
} from './trackHeaderModel';
import { TrackRoleLine } from './TrackRoleLine';

interface TrackHeaderLabels {
  muted: string;
  audible: string;
  locked: string;
  unlocked: string;
  syncLocked: string;
  syncUnlocked: string;
  moveLayerUp: string;
  moveLayerDown: string;
  renameTrack: string;
  addClip?: string;
  showTrack?: string;
  hideTrack?: string;
  deleteTrack?: string;
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

interface TrackHeaderProps {
  track: VideoTimelineTrack;
  labels: TrackHeaderLabels;
  selected: boolean;
  onToggleMute: (track: VideoTimelineTrack) => void;
  onToggleLock: (track: VideoTimelineTrack) => void;
  onToggleSyncLock?: (track: VideoTimelineTrack) => void;
  onToggleVisibility?: (track: VideoTimelineTrack) => void;
  onDeleteTrack?: (track: VideoTimelineTrack) => void;
  onRename: (trackId: string, name: string) => void;
  onMoveLayer?: (trackId: string, direction: 'up' | 'down') => void;
  onSelectTrack?: (trackId: string) => void;
  /** Optional callback for the "+ Add clip" button. Receives user-picked files. */
  onAddClipFiles?: (track: VideoTimelineTrack, files: File[]) => void;
}

export function TrackHeader({
  track,
  labels,
  selected,
  onToggleMute,
  onToggleLock,
  onToggleSyncLock,
  onToggleVisibility,
  onDeleteTrack,
  onRename,
  onMoveLayer,
  onSelectTrack,
  onAddClipFiles,
}: TrackHeaderProps) {
  const isVisualTrack = isVisualTimelineTrack(track);
  const hidden = isVisualTrack ? track.hidden === true : false;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRenameRef = useRef(false);
  const [draftName, setDraftName] = useState(track.name);
  const TrackIcon = getTrackIcon(track);
  const selectTrack = () => onSelectTrack?.(track.id);

  useEffect(() => {
    setDraftName(track.name);
  }, [track.name]);

  const commitName = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setDraftName(track.name);
      return;
    }
    const nextName = draftName.trim();
    if (!nextName) {
      setDraftName(track.name);
      return;
    }
    if (nextName !== track.name) onRename(track.id, nextName);
    setDraftName(nextName);
  };

  return (
    <div
      className={cn(
        // `bg-background` stays solid in every state so horizontally-scrolled
        // clips never bleed through the sticky left column. The selected/hover
        // tint is layered on top via the overlay span below.
        'group bg-background sticky left-0 z-20 flex h-full cursor-pointer items-center gap-2 border-r px-3 transition-colors',
        selected ? 'border-primary' : 'border-border',
      )}
      onClick={selectTrack}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 transition-colors',
          selected ? 'bg-primary/10' : 'group-hover:bg-muted/40',
        )}
      />
      <button
        type="button"
        className="focus-visible:ring-primary/50 absolute inset-0 z-0 rounded-none outline-none focus-visible:ring-2 focus-visible:ring-inset"
        aria-label={track.name}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation();
          selectTrack();
        }}
      />
      <span
        aria-hidden
        className={cn(
          'absolute top-1 bottom-1 left-0 w-1 rounded-r-full transition-opacity',
          selected ? 'bg-primary opacity-100' : 'opacity-0',
        )}
      />
      <TrackIcon
        className={cn(
          'relative z-10 size-4 shrink-0',
          selected ? 'text-primary' : 'text-muted-foreground',
        )}
      />
      <div className="relative z-10 min-w-0 flex-1">
        <input
          type="text"
          value={draftName}
          aria-label={labels.renameTrack}
          className="focus:ring-primary/40 text-foreground hover:bg-accent/60 focus:bg-background w-full truncate rounded-sm bg-transparent px-1 py-0.5 text-xs font-medium outline-none focus:ring-1"
          onChange={(event) => setDraftName(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            selectTrack();
            event.stopPropagation();
          }}
          onFocus={(event) => {
            selectTrack();
            event.currentTarget.select();
          }}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelRenameRef.current = true;
              setDraftName(track.name);
              event.currentTarget.blur();
            }
          }}
        />
        <TrackRoleLine track={track} labels={labels} />
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px]">
          {trackHasAudio(track) ? (
            <button
              type="button"
              className="hover:text-foreground rounded-sm"
              aria-label={track.muted ? labels.muted : labels.audible}
              aria-pressed={track.muted}
              onClick={(event) => {
                event.stopPropagation();
                onToggleMute(track);
              }}
            >
              {track.muted ? (
                <VolumeX className="size-3" />
              ) : (
                <Volume2 className="size-3" />
              )}
            </button>
          ) : null}
          {isVisualTrack && onToggleVisibility ? (
            <button
              type="button"
              className="hover:text-foreground rounded-sm"
              aria-label={
                hidden
                  ? (labels.showTrack ?? 'Show')
                  : (labels.hideTrack ?? 'Hide')
              }
              aria-pressed={hidden}
              onClick={(event) => {
                event.stopPropagation();
                onToggleVisibility(track);
              }}
            >
              {hidden ? (
                <EyeOff className="size-3" />
              ) : (
                <Eye className="size-3" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="hover:text-foreground rounded-sm"
            aria-label={track.locked ? labels.locked : labels.unlocked}
            aria-pressed={track.locked}
            onClick={(event) => {
              event.stopPropagation();
              onToggleLock(track);
            }}
          >
            {track.locked ? (
              <Lock className="size-3" />
            ) : (
              <Unlock className="size-3" />
            )}
          </button>
          {onToggleSyncLock ? (
            <button
              type="button"
              className="hover:text-foreground rounded-sm"
              aria-label={
                track.syncLocked ? labels.syncLocked : labels.syncUnlocked
              }
              aria-pressed={track.syncLocked}
              onClick={(event) => {
                event.stopPropagation();
                onToggleSyncLock(track);
              }}
            >
              {track.syncLocked ? (
                <Shield className="size-3" />
              ) : (
                <ShieldOff className="size-3" />
              )}
            </button>
          ) : null}
          {onMoveLayer && trackSupportsLayerOrder(track) ? (
            <>
              <button
                type="button"
                className="hover:text-foreground rounded-sm"
                aria-label={labels.moveLayerUp}
                title={labels.moveLayerUp}
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveLayer(track.id, 'up');
                }}
              >
                <ArrowUp className="size-3" />
              </button>
              <button
                type="button"
                className="hover:text-foreground rounded-sm"
                aria-label={labels.moveLayerDown}
                title={labels.moveLayerDown}
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveLayer(track.id, 'down');
                }}
              >
                <ArrowDown className="size-3" />
              </button>
            </>
          ) : null}
          {onDeleteTrack ? (
            <button
              type="button"
              className="hover:text-destructive rounded-sm"
              aria-label={labels.deleteTrack ?? 'Delete track'}
              title={labels.deleteTrack ?? 'Delete track'}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteTrack(track);
              }}
            >
              <Trash2 className="size-3" />
            </button>
          ) : null}
          {onAddClipFiles && !track.locked && trackAcceptsClipUpload(track) ? (
            <>
              <button
                type="button"
                className="hover:text-foreground rounded-sm"
                aria-label={labels.addClip ?? 'Add clip'}
                title={labels.addClip ?? 'Add clip'}
                onClick={(event) => {
                  event.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <Plus className="size-3" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={fileAcceptForTrack(track)}
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length > 0) onAddClipFiles(track, files);
                  event.target.value = '';
                }}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
