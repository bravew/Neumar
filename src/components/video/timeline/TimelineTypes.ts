import type { MouseEvent } from 'react';

import type {
  VideoAgentToolCallInput,
  VideoAspectRatio,
  VideoProject,
  VideoTimeline,
} from '@/shared/types/video';

export type TimelineSceneSelectionSource = 'user' | 'timeline';

export interface TimelineSceneSelectOptions {
  source?: TimelineSceneSelectionSource;
}

export interface TimelineProps {
  project: VideoProject;
  aspectRatio?: VideoAspectRatio;
  selectedSceneId?: string | null;
  selectedSceneSource?: TimelineSceneSelectionSource;
  onSelectScene?: (
    sceneId: string,
    options?: TimelineSceneSelectOptions,
  ) => void;
  onTimelineChange?: (timeline: VideoTimeline) => Promise<VideoProject | null>;
  onTogglePlayback?: (event: MouseEvent<HTMLButtonElement>) => void;
  onUndoAgentJournalEntry?: (entryId: string) => Promise<unknown> | unknown;
  onRedoAgentJournalEntry?: (entryId: string) => Promise<unknown> | unknown;
  onApplyAgentTool?: (
    input: VideoAgentToolCallInput,
  ) => Promise<unknown> | unknown;
  onAttachLinkedAsset?: (assetId: string) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
  } | null>;
  onAttachCatalogAsset?: (assetId: string) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
  } | null>;
  // Use-site hydration for reference-only project assets. Timeline drops
  // insert a placeholder clip first, then start hydration in the background.
  onHydrateProjectAsset?: (
    mediaItemId: string,
    input?: { sessionId?: string },
  ) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
  } | null>;
  /** Upload native OS files and return the resulting project (assets list). */
  onUploadAssets?: (files: FileList | File[]) => Promise<VideoProject | null>;
  className?: string;
}
