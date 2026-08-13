import type { MouseEvent, ReactNode, SVGProps } from 'react';

import {
  Captions,
  Film,
  Flag,
  Layers,
  Layers2,
  Layers3,
  Magnet,
  Maximize2,
  Mic,
  MousePointer2,
  Music,
  Pause,
  Play,
  RotateCcw,
  Type,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { VideoTimelineTrack } from '@/shared/types/video';

import { TimelineBookendControls } from './TimelineBookendControls';
import { TimelineClipAdjustments } from './TimelineClipAdjustments';
import { TimelineIconButton } from './TimelineIconButton';
import { TIMELINE_ZOOM } from './timelineMath';
import { useTimelineUiStore } from './useTimelineUiStore';

type TimelinePlaybackState = 'stopped' | 'playing' | 'paused';

interface TimelineToolbarLabels {
  play: string;
  pause: string;
  zoomOut: string;
  zoomIn: string;
  zoomFit: string;
  resetZoom: string;
  addVideoLayer: string;
  addTrack: string;
  trackKindVideo: string;
  trackKindBroll: string;
  trackKindOverlay: string;
  trackKindAudioVo: string;
  trackKindAudioMusic: string;
  trackKindAudioSfx: string;
  trackKindCaption: string;
  trackKindVisualGroup: string;
  trackKindAudioGroup: string;
  trackKindOtherGroup: string;
  addCaption: string;
  toggleSnapping: string;
  addMarker: string;
  selectTool: string;
  razorTool: string;
}

interface TimelineToolbarProps {
  playbackState: TimelinePlaybackState;
  pixelsPerSecond: number;
  snappingEnabled: boolean;
  labels: TimelineToolbarLabels;
  onTogglePlayback: (event: MouseEvent<HTMLButtonElement>) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomToFit: () => void;
  onResetZoom: () => void;
  onAddVideoTrack: () => void;
  onAddTrack?: (kind: VideoTimelineTrack['kind']) => void;
  onAddCaption?: () => void;
  onToggleSnapping: () => void;
  onAddMarker: () => void;
}

export function TimelineToolbar({
  playbackState,
  pixelsPerSecond,
  snappingEnabled,
  labels,
  onTogglePlayback,
  onZoomOut,
  onZoomIn,
  onZoomToFit,
  onResetZoom,
  onAddVideoTrack,
  onAddTrack,
  onAddCaption,
  onToggleSnapping,
  onAddMarker,
}: TimelineToolbarProps) {
  const razorToolEnabled = useTimelineUiStore(
    (state) => state.razorToolEnabled,
  );
  const setRazorToolEnabled = useTimelineUiStore(
    (state) => state.setRazorToolEnabled,
  );
  return (
    <div
      className="flex items-center gap-2"
      role="toolbar"
      aria-label="Timeline toolbar"
    >
      <ToolbarGroup>
        <TimelineIconButton
          label={playbackState === 'playing' ? labels.pause : labels.play}
          shortcut="Space"
          onClick={onTogglePlayback}
        >
          {playbackState === 'playing' ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
        </TimelineIconButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <TimelineIconButton
          label={labels.selectTool}
          shortcut="V"
          pressed={!razorToolEnabled}
          onClick={() => setRazorToolEnabled(false)}
        >
          <MousePointer2 className="size-3.5" />
        </TimelineIconButton>
        <TimelineIconButton
          label={labels.razorTool}
          shortcut="B / C"
          pressed={razorToolEnabled}
          onClick={() => setRazorToolEnabled(true)}
        >
          <RazorToolIcon className="size-3.5" />
        </TimelineIconButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <TimelineIconButton
          label={labels.addMarker}
          shortcut="M"
          onClick={onAddMarker}
        >
          <Flag className="size-3.5" />
        </TimelineIconButton>
        <AddTrackMenu
          labels={labels}
          onAddTrack={(kind) => {
            if (onAddTrack) onAddTrack(kind);
            else if (kind === 'video') onAddVideoTrack();
          }}
        />
        {onAddCaption ? (
          <TimelineIconButton label={labels.addCaption} onClick={onAddCaption}>
            <Type className="size-3.5" />
          </TimelineIconButton>
        ) : null}
      </ToolbarGroup>

      <ToolbarGroup>
        <TimelineBookendControls />
        <TimelineClipAdjustments />
      </ToolbarGroup>

      <ToolbarGroup>
        <TimelineIconButton
          label={labels.toggleSnapping}
          shortcut="S / N"
          pressed={snappingEnabled}
          onClick={onToggleSnapping}
        >
          <Magnet className="size-3.5" />
        </TimelineIconButton>
        <TimelineIconButton
          label={labels.zoomOut}
          shortcut="-"
          onClick={onZoomOut}
        >
          <ZoomOut className="size-3.5" />
        </TimelineIconButton>
        <TimelineIconButton
          label={labels.zoomIn}
          shortcut="="
          onClick={onZoomIn}
        >
          <ZoomIn className="size-3.5" />
        </TimelineIconButton>
        <TimelineIconButton
          label={labels.zoomFit}
          shortcut="Shift+Z"
          onClick={onZoomToFit}
        >
          <Maximize2 className="size-3.5" />
        </TimelineIconButton>
        <TimelineIconButton label={labels.resetZoom} onClick={onResetZoom}>
          <RotateCcw className="size-3.5" />
        </TimelineIconButton>
        <span className="text-muted-foreground min-w-12 text-right text-[11px]">
          {Math.round((pixelsPerSecond / TIMELINE_ZOOM.DEFAULT) * 100)}%
        </span>
      </ToolbarGroup>
    </div>
  );
}

function ToolbarGroup({ children }: { children: ReactNode }) {
  return (
    <div className="border-border/70 bg-muted/20 flex items-center gap-1 rounded-lg border p-0.5">
      {children}
    </div>
  );
}

function RazorToolIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        d="M4.5 19.5 14.8 9.2l5 5L9.5 21H5a.5.5 0 0 1-.5-.5v-1Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="m11.3 6.7 2.4-2.4 6 6-2.4 2.4-6-6Z" fill="currentColor" />
      <path
        d="m7 18 8.2-8.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function AddTrackMenu({
  labels,
  onAddTrack,
}: {
  labels: TimelineToolbarLabels;
  onAddTrack: (kind: VideoTimelineTrack['kind']) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        title={labels.addTrack}
        aria-label={labels.addTrack}
        className="border-border hover:bg-accent rounded-md border p-1.5"
      >
        <Layers className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>{labels.trackKindVisualGroup}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onAddTrack('video')}>
          <Film className="size-3.5" />
          {labels.trackKindVideo}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddTrack('broll')}>
          <Layers2 className="size-3.5" />
          {labels.trackKindBroll}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddTrack('overlay')}>
          <Layers3 className="size-3.5" />
          {labels.trackKindOverlay}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{labels.trackKindAudioGroup}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onAddTrack('audio-vo')}>
          <Mic className="size-3.5" />
          {labels.trackKindAudioVo}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddTrack('audio-music')}>
          <Music className="size-3.5" />
          {labels.trackKindAudioMusic}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddTrack('audio-sfx')}>
          <Volume2 className="size-3.5" />
          {labels.trackKindAudioSfx}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{labels.trackKindOtherGroup}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onAddTrack('caption')}>
          <Captions className="size-3.5" />
          {labels.trackKindCaption}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
