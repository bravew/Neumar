import type {
  VideoAgentToolCallInput,
  VideoAgentToolExecution,
  VideoAssetPlan,
  VideoAspectRatio,
  VideoCaptionRenderMode,
  VideoEditorHandoffJobStatus,
  VideoEditorHandoffMediaMode,
  VideoEditorHandoffTarget,
  VideoLinkedAsset,
  VideoLinkedFolderChild,
  VideoLinkedAssetKind,
  VideoLinkedAssetSearchCapability,
  VideoLinkedAssetSearchHit,
  VideoLinkedSource,
  VideoMusicPlan,
  VideoNarrationSegment,
  VideoLinkedSourceProvider,
  VideoLinkedSourceRole,
  VideoLoudnessTargetLufs,
  VideoJob,
  VideoProject,
  VideoRenderPlan,
  VideoSourceMedia,
  VideoStoryboard,
  VideoStoryboardScene,
  VideoSubtitle,
  VideoTimeline,
} from '@/shared/types/video';

export type VideoEditorStep =
  | 'brief'
  | 'board'
  | 'plan'
  | 'generate'
  | 'preview';

export const VIDEO_EDITOR_STEPS: VideoEditorStep[] = [
  'brief',
  'board',
  'plan',
  'generate',
  'preview',
];

export interface VideoProjectEditorActions {
  /**
   * Replace local project state with a server response's `project` when the
   * caller already has the authoritative document (e.g. a mutation route
   * that returns the full project) and a round trip through `patchProject`
   * would be redundant.
   */
  onProjectUpdated?: (project: VideoProject) => void;
  patchProject: (patch: Partial<VideoProject>) => Promise<VideoProject | null>;
  uploadAssets: (files: FileList | File[]) => Promise<VideoProject | null>;
  uploadReferenceImages: (files: FileList | File[]) => Promise<{
    project: VideoProject;
    assets: VideoProject['assets'];
  } | null>;
  attachAssetPaths: (
    paths: string[],
    mode?: 'copy' | 'reference',
  ) => Promise<VideoProject | null>;
  deleteAsset: (assetId: string) => Promise<VideoProject | null>;
  regenerateAssetProxy: (assetId: string) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
    generated: boolean;
    skippedReason?: string;
  } | null>;
  deleteAssetProxy: (assetId: string) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
  } | null>;
  importSourcePath: (
    path: string,
    userConfirmed?: boolean,
  ) => Promise<VideoProject | null>;
  importSourceFile: (
    file: File,
    userConfirmed?: boolean,
  ) => Promise<VideoProject | null>;
  importCaptureFiles: (files: FileList | File[]) => Promise<{
    project: VideoProject;
    sources: VideoSourceMedia[];
    assets: VideoProject['assets'];
  } | null>;
  importCapturePaths: (paths: string[]) => Promise<{
    project: VideoProject;
    sources: VideoSourceMedia[];
    assets: VideoProject['assets'];
  } | null>;
  alignCapture: (captureId: string) => Promise<{
    project: VideoProject;
    source: VideoSourceMedia;
    subtitles: VideoSubtitle[];
    markers: Array<{
      sceneId: string;
      startMs: number;
      endMs: number;
      confidence: number;
      transcriptText: string;
    }>;
  } | null>;
  queueYtDlpImport: (
    url: string,
    userConfirmedRights: boolean,
  ) => Promise<{ job: { id: string; status: string } } | null>;
  analyzeSource: (sourceId: string) => Promise<VideoProject | null>;
  createCutPlan: (
    sourceId: string,
    candidateIds: string[],
  ) => Promise<VideoProject | null>;
  generateStoryboard: (message: string) => Promise<VideoProject | null>;
  updateStoryboard: (
    storyboard: VideoStoryboard,
  ) => Promise<VideoProject | null>;
  approveStoryboard: () => Promise<VideoProject | null>;
  createRenderPlan: () => Promise<{
    project: VideoProject;
    renderPlan: VideoRenderPlan;
  } | null>;
  updateRenderPlanSceneModel: (
    sceneId: string,
    providerId: string,
  ) => Promise<{
    project: VideoProject;
    renderPlan: VideoRenderPlan;
  } | null>;
  updateTimeline: (timeline: VideoTimeline) => Promise<VideoProject | null>;
  applyAgentTool: (
    input: VideoAgentToolCallInput,
  ) => Promise<VideoAgentToolExecution | null>;
  undoAgentJournalEntry: (
    entryId: string,
  ) => Promise<VideoAgentToolExecution | null>;
  redoAgentJournalEntry: (
    entryId: string,
  ) => Promise<VideoAgentToolExecution | null>;
  rejectStoryboard: () => Promise<VideoProject | null>;
  replanScene: (sceneId: string, hint?: string) => Promise<VideoProject | null>;
  materializeSceneAsset: (sceneId: string) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
  } | null>;
  regenerateScene: (
    sceneId: string,
    input: {
      prompt?: string;
      lipsyncText?: string;
      voiceId?: string;
      voiceProvider?: string;
      refImageAssetId?: string;
      refImageTailAssetId?: string;
      provider?: string;
      durationMs?: number;
      seed?: number;
      motionScale?: number;
      background?: Extract<VideoAssetPlan, { kind: 'lipsync' }>['background'];
      confirmReferenceUpload?: boolean;
    },
  ) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
  } | null>;
  generateMusic: (input: VideoMusicPlan) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
    costCents: number;
  } | null>;
  generateNarration: (input: {
    segments?: VideoNarrationSegment[];
    voiceId?: string;
    provider?: string;
  }) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
    costCents: number;
    segments: VideoNarrationSegment[];
  } | null>;
  setRenderCaptionMode: (
    mode: VideoCaptionRenderMode,
  ) => Promise<VideoProject | null>;
  grantLocalFolder: (rootPath: string) => Promise<{
    token: string;
    rootPath: string;
    expiresAt: string;
  }>;
  addLinkedSource: (input: {
    provider: VideoLinkedSourceProvider;
    connectionId?: string;
    rootPath: string;
    displayName?: string;
    role?: VideoLinkedSourceRole;
    filters?: VideoLinkedSource['filters'];
    budget?: VideoLinkedSource['budget'];
    localGrantToken?: string;
  }) => Promise<{ project: VideoProject; source: VideoLinkedSource } | null>;
  syncLinkedSource: (sourceId: string) => Promise<{
    project: VideoProject;
    source: VideoLinkedSource;
    job: { id: string; status: string };
  } | null>;
  removeLinkedSource: (sourceId: string) => Promise<VideoProject | null>;
  listLinkedAssets: (
    input: {
      sourceId?: string;
      kind?: VideoLinkedAssetKind;
      query?: string;
      limit?: number;
      offset?: number;
    },
    signal?: AbortSignal,
  ) => Promise<{ assets: VideoLinkedAsset[] }>;
  listLinkedFolderChildren: (
    input: {
      sourceId: string;
      path?: string;
      page?: string;
      limit?: number;
      kinds?: VideoLinkedAssetKind[];
    },
    signal?: AbortSignal,
  ) => Promise<{ entries: VideoLinkedFolderChild[]; nextCursor?: string }>;
  listRecentLinkedAssets: (
    limit?: number,
    signal?: AbortSignal,
  ) => Promise<{ assets: VideoLinkedAsset[] }>;
  listFavoriteLinkedAssets: (
    limit?: number,
    signal?: AbortSignal,
  ) => Promise<{ assets: VideoLinkedAsset[] }>;
  setLinkedAssetFavorite: (
    assetId: string,
    favorite: boolean,
  ) => Promise<{ asset: VideoLinkedAsset } | null>;
  markLinkedAssetOpened: (
    assetId: string,
  ) => Promise<{ asset: VideoLinkedAsset } | null>;
  searchLinkedAssets: (
    input: {
      query?: string;
      kind?: Exclude<VideoLinkedAssetKind, 'other'>;
      sourceIds?: string[];
      role?: VideoLinkedSourceRole;
      durationMs?: { min?: number; max?: number };
      aspectRatio?: VideoAspectRatio;
      limit?: number;
    },
    signal?: AbortSignal,
  ) => Promise<{
    results: VideoLinkedAssetSearchHit[];
    capability: VideoLinkedAssetSearchCapability;
  }>;
  attachLinkedAsset: (
    assetId: string,
    sceneId?: string,
  ) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
  } | null>;
  attachCatalogAsset: (
    assetId: string,
    input?: { sessionId?: string; hydrate?: 'none' | 'proxy' | 'full' },
  ) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
  } | null>;
  // Triggers a use-site hydration for a reference-only MediaItem
  // (drop-on-timeline, render preflight, agent transcode). No-op if the
  // asset is already `'ready'`. Throws on materializer / budget errors.
  hydrateProjectAsset: (
    mediaItemId: string,
    input?: { sessionId?: string },
  ) => Promise<{
    project: VideoProject;
    asset: VideoProject['assets'][number];
  } | null>;
  // Cancel an in-flight hydration. The rail tile's cancel-X (visible on
  // hover of the progress badge) routes here; the materializer fires
  // `AbortController.abort()` on the active download. Returns true when
  // something was actually cancelled.
  cancelProjectAssetHydration: (mediaItemId: string) => Promise<boolean>;
  setFrameNativeEnhancement: (
    nodeId: string,
    enabled: boolean,
    nativeTemplateId?: string,
  ) => Promise<VideoProject | null>;
  applyTemplate: (
    templateId: string,
    inputs: Record<string, unknown>,
    name?: string,
  ) => Promise<VideoProject | null>;
  renderProject: (
    aspectRatio: VideoAspectRatio,
    options?: {
      mode?: 'speed' | 'reproducible';
      renderer?: 'ffmpeg' | 'remotion' | 'webcodecs';
      where?: 'local' | 'cloud';
      renderProviderId?: string;
      cloudEgressConfirmed?: boolean;
      loudnessTargetLufs?: VideoLoudnessTargetLufs;
      autoColor?: boolean;
      autoReframe?: boolean;
      captionMode?: VideoCaptionRenderMode;
    },
  ) => Promise<unknown>;
  queueRenderProject: (
    aspectRatios: VideoAspectRatio[],
    options?: {
      mode?: 'speed' | 'reproducible';
      renderer?: 'ffmpeg' | 'remotion' | 'webcodecs';
      where?: 'local' | 'cloud';
      renderProviderId?: string;
      cloudEgressConfirmed?: boolean;
      loudnessTargetLufs?: VideoLoudnessTargetLufs;
      autoColor?: boolean;
      autoReframe?: boolean;
      captionMode?: VideoCaptionRenderMode;
    },
  ) => Promise<VideoJob | null>;
  queueEditorHandoff: (input: {
    targets: VideoEditorHandoffTarget[];
    mediaMode?: VideoEditorHandoffMediaMode;
  }) => Promise<VideoJob | null>;
  getEditorHandoffJob: (
    jobId: string,
    signal?: AbortSignal,
  ) => Promise<VideoEditorHandoffJobStatus | null>;
  cancelRender: () => Promise<unknown>;
}

export interface SceneEditorProps {
  project: VideoProject;
  scene: VideoStoryboardScene | null;
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  actions: VideoProjectEditorActions;
}
