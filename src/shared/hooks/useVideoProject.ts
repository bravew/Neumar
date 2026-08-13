import { useCallback, useEffect, useRef, useState } from 'react';

import type { TimelineHistoryEntry, TimelineOp } from '@neumar/video-ir';

import type { VideoEditorStep } from '@/components/video/editorTypes';
import { API_BASE_URL } from '@/config';
import { materializationBudgetErrorFromApiData } from '@/shared/assets';
import type {
  VideoAspectRatio,
  VideoAssetPlan,
  VideoAgentToolCallInput,
  VideoAgentToolExecution,
  VideoCaptionRenderMode,
  VideoEditorHandoffJobStatus,
  VideoEditorHandoffMediaMode,
  VideoEditorHandoffTarget,
  VideoJob,
  VideoProject,
  VideoLinkedAsset,
  VideoLinkedFolderChild,
  VideoLinkedAssetKind,
  VideoLinkedAssetSearchCapability,
  VideoLinkedAssetSearchHit,
  VideoLinkedSource,
  VideoMusicPlan,
  VideoNarrationSegment,
  VideoLoudnessTargetLufs,
  VideoLinkedSourceProvider,
  VideoLinkedSourceRole,
  VideoProjectListItem,
  VideoProviderView,
  VideoRenderProviderView,
  VideoRenderPlan,
  VideoSourceMedia,
  VideoStoryboard,
  VideoSubtitle,
  VideoTemplate,
  VideoTemplateId,
  VideoTimeline,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

export type { VideoEditorStep };

export interface VideoTimelineOpExecution {
  project: VideoProject;
  timeline: VideoTimeline;
  entry: TimelineHistoryEntry;
  inverse: TimelineOp;
}

export class VideoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'VideoApiError';
  }
}

async function videoApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/video${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  const data = (await response.json()) as T & {
    error?: string;
  } & Record<string, unknown>;
  if (!response.ok) {
    const budgetError = materializationBudgetErrorFromApiData(
      data,
      data.error || `HTTP ${response.status}`,
    );
    if (budgetError) throw budgetError;
    throw new VideoApiError(
      data.error || `HTTP ${response.status}`,
      response.status,
      data,
    );
  }
  return data;
}

function mergeAttachedProjectAsset(
  current: VideoProject | null,
  nextProject: VideoProject,
  attachedAsset: VideoProject['assets'][number],
): VideoProject {
  if (!current || current.id !== nextProject.id) return nextProject;

  const assets = [...current.assets];
  const assetIndexById = new Map(
    assets.map((asset, index) => [asset.id, index] as const),
  );

  for (const asset of nextProject.assets) {
    if (assetIndexById.has(asset.id)) continue;
    assetIndexById.set(asset.id, assets.length);
    assets.push(asset);
  }

  const attachedIndex = assetIndexById.get(attachedAsset.id);
  if (attachedIndex == null) {
    assets.push(attachedAsset);
  } else {
    assets[attachedIndex] = attachedAsset;
  }

  return {
    ...current,
    assets,
    updatedAt:
      nextProject.updatedAt > current.updatedAt
        ? nextProject.updatedAt
        : current.updatedAt,
  };
}

export function deriveVideoEditorStep(project: VideoProject): VideoEditorStep {
  if (!project.storyboard) return 'brief';
  if (project.storyboard.status !== 'approved') return 'board';
  if (project.render?.status === 'running') return 'generate';
  if (project.render?.status === 'done') return 'preview';
  if (!project.renderPlan) return 'plan';
  return 'generate';
}

interface VideoProjectPollingOptions {
  projectId: string | undefined;
  active: boolean;
  onProject: (project: VideoProject) => void;
}

const VIDEO_PROJECT_POLL_MS = 1500;
// When `active` flips false (stream ended, render done), keep polling for
// this long. Reason: lifecycle hooks like the asset-ingest writer can
// settle slightly after the stream's RUN_FINISHED. Without the grace
// window the UI stops fetching the moment streaming becomes false, and a
// just-registered MediaItem never reaches the React tree.
const POST_ACTIVE_GRACE_MS = 3000;

export function useVideoProjectPolling({
  projectId,
  active,
  onProject,
}: VideoProjectPollingOptions) {
  useEffect(() => {
    if (!projectId) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    // When `active` is false but we just transitioned, keep polling up to
    // this deadline (`undefined` while active === true).
    const graceDeadline = active ? null : Date.now() + POST_ACTIVE_GRACE_MS;

    const poll = async () => {
      controller?.abort();
      controller = new AbortController();

      try {
        const data = await videoApi<{ project: VideoProject }>(
          `/projects/${encodeURIComponent(projectId)}`,
          { signal: controller.signal },
        );
        if (stopped || controller.signal.aborted) return;

        onProject(data.project);

        const renderStillRunning = data.project.render?.status === 'running';
        const withinGrace =
          graceDeadline !== null && Date.now() < graceDeadline;

        if (active || renderStillRunning || withinGrace) {
          timer = setTimeout(poll, VIDEO_PROJECT_POLL_MS);
        }
      } catch {
        if (stopped || controller.signal.aborted) return;
        const withinGrace =
          graceDeadline !== null && Date.now() < graceDeadline;
        if (active || withinGrace) {
          timer = setTimeout(poll, VIDEO_PROJECT_POLL_MS);
        }
      }
    };

    // Active path: schedule the usual interval. Grace path: schedule one
    // immediate refresh so a newly-ended stream's tail mutations land
    // promptly.
    timer = setTimeout(poll, active ? VIDEO_PROJECT_POLL_MS : 250);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [active, onProject, projectId]);
}

async function readStoryboardStream(
  response: Response,
  onStoryboard: (project: VideoProject, storyboard: VideoStoryboard) => void,
): Promise<void> {
  if (!response.ok) {
    const data = (await response.json()) as { error?: string };
    throw new VideoApiError(
      data.error || `HTTP ${response.status}`,
      response.status,
      data as Record<string, unknown>,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const dataLine = chunk
        .split('\n')
        .find((line) => line.startsWith('data: '));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice(6)) as {
        type?: string;
        project?: VideoProject;
        storyboard?: VideoStoryboard;
        message?: string;
      };
      if (event.type === 'error') {
        throw new Error(event.message || 'Storyboard generation failed');
      }
      if (event.type === 'storyboard' && event.project && event.storyboard) {
        onStoryboard(event.project, event.storyboard);
      }
    }
  }
}

export function useVideoProjects() {
  const [projects, setProjects] = useState<VideoProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await videoApi<{ projects: VideoProjectListItem[] }>(
        '/projects',
        { signal },
      );
      if (!signal?.aborted) {
        setProjects(data.projects);
        setError(null);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  return { projects, loading, error, refresh, setProjects };
}

export function useVideoProject(projectId: string | undefined) {
  const [project, setProject] = useState<VideoProject | null>(null);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!projectId) return;
      setLoading(true);
      try {
        const data = await videoApi<{ project: VideoProject }>(
          `/projects/${encodeURIComponent(projectId)}`,
          { signal },
        );
        if (!signal?.aborted) {
          setProject(data.project);
          setError(null);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  const storyboardStreamRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      storyboardStreamRef.current?.abort();
      storyboardStreamRef.current = null;
    };
  }, [projectId]);

  const patchProject = useCallback(
    async (patch: Partial<VideoProject>) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const uploadAssets = useCallback(
    async (files: FileList | File[]) => {
      if (!projectId) return null;
      const form = new FormData();
      Array.from(files).forEach((file) => form.append('file', file));
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/assets`,
        { method: 'POST', body: form },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const uploadReferenceImages = useCallback(
    async (files: FileList | File[]) => {
      if (!projectId) return null;
      const form = new FormData();
      Array.from(files).forEach((file) => form.append('file', file));
      const data = await videoApi<{
        project: VideoProject;
        assets: VideoProject['assets'];
      }>(`/projects/${encodeURIComponent(projectId)}/assets?kind=image`, {
        method: 'POST',
        body: form,
      });
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const attachAssetPaths = useCallback(
    async (paths: string[]) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/assets`,
        {
          method: 'POST',
          body: JSON.stringify({ paths }),
        },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const deleteAsset = useCallback(
    async (assetId: string) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(
          assetId,
        )}`,
        { method: 'DELETE' },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const regenerateAssetProxy = useCallback(
    async (assetId: string) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        asset: VideoProject['assets'][number];
        generated: boolean;
        skippedReason?: string;
      }>(
        `/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(
          assetId,
        )}/proxy`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const deleteAssetProxy = useCallback(
    async (assetId: string) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        asset: VideoProject['assets'][number];
      }>(
        `/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(
          assetId,
        )}/proxy`,
        { method: 'DELETE' },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const importSourcePath = useCallback(
    async (path: string, userConfirmed = true) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/sources/import`,
        {
          method: 'POST',
          body: JSON.stringify({
            path,
            rights: { userConfirmed },
          }),
        },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const importSourceFile = useCallback(
    async (file: File, userConfirmed = true) => {
      if (!projectId) return null;
      const form = new FormData();
      form.append('file', file);
      form.append('userConfirmedRights', String(userConfirmed));
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/sources/import`,
        { method: 'POST', body: form },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const importCaptureFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!projectId) return null;
      const form = new FormData();
      Array.from(files).forEach((file) => form.append('file', file));
      form.append('userConfirmedRights', 'true');
      const data = await videoApi<{
        project: VideoProject;
        sources: VideoSourceMedia[];
        assets: VideoProject['assets'];
      }>(`/projects/${encodeURIComponent(projectId)}/captures/import`, {
        method: 'POST',
        body: form,
      });
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const importCapturePaths = useCallback(
    async (paths: string[]) => {
      if (!projectId || paths.length === 0) return null;
      const data = await videoApi<{
        project: VideoProject;
        sources: VideoSourceMedia[];
        assets: VideoProject['assets'];
      }>(`/projects/${encodeURIComponent(projectId)}/captures/import`, {
        method: 'POST',
        body: JSON.stringify({
          paths,
          rights: { userConfirmed: true },
        }),
      });
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const alignCapture = useCallback(
    async (captureId: string) => {
      if (!projectId) return null;
      const data = await videoApi<{
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
      }>(
        `/projects/${encodeURIComponent(projectId)}/captures/${encodeURIComponent(captureId)}/align`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const queueYtDlpImport = useCallback(
    async (url: string, userConfirmedRights: boolean) => {
      if (!projectId || !userConfirmedRights) return null;
      return videoApi<{ job: { id: string; status: string } }>(
        `/projects/${encodeURIComponent(projectId)}/sources/ytdl`,
        {
          method: 'POST',
          body: JSON.stringify({
            url,
            format: 'mp4',
            userConfirmedRights,
          }),
        },
      );
    },
    [projectId],
  );

  const analyzeSource = useCallback(
    async (sourceId: string) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(
          sourceId,
        )}/analyze`,
        { method: 'POST' },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const createCutPlan = useCallback(
    async (sourceId: string, candidateIds: string[]) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(
          sourceId,
        )}/cut-plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            candidateIds,
            approved: true,
            mode: 'cut',
          }),
        },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const generateStoryboard = useCallback(
    async (message: string) => {
      if (!projectId) return null;
      storyboardStreamRef.current?.abort();
      const controller = new AbortController();
      storyboardStreamRef.current = controller;
      let latestProject: VideoProject | null = null;
      try {
        const response = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/agent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, mode: 'storyboard' }),
            signal: controller.signal,
          },
        );
        await readStoryboardStream(response, (nextProject) => {
          if (controller.signal.aborted) return;
          latestProject = nextProject;
          setProject(nextProject);
        });
        return latestProject;
      } catch (err) {
        if (controller.signal.aborted) return null;
        throw err;
      } finally {
        if (storyboardStreamRef.current === controller) {
          storyboardStreamRef.current = null;
        }
      }
    },
    [projectId],
  );

  const updateStoryboard = useCallback(
    async (storyboard: VideoStoryboard) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        storyboard: VideoStoryboard;
      }>(`/projects/${encodeURIComponent(projectId)}/storyboard`, {
        method: 'PATCH',
        body: JSON.stringify({ patch: storyboard }),
      });
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const approveStoryboard = useCallback(async () => {
    if (!projectId) return null;
    const data = await videoApi<{ project: VideoProject }>(
      `/projects/${encodeURIComponent(projectId)}/storyboard/approve`,
      { method: 'POST' },
    );
    setProject(data.project);
    return data.project;
  }, [projectId]);

  const createRenderPlan = useCallback(async () => {
    if (!projectId) return null;
    const data = await videoApi<{
      project: VideoProject;
      renderPlan: VideoRenderPlan;
    }>(`/projects/${encodeURIComponent(projectId)}/render-plan`, {
      method: 'POST',
    });
    setProject(data.project);
    return data;
  }, [projectId]);

  const updateRenderPlanSceneModel = useCallback(
    async (sceneId: string, providerId: string) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        renderPlan: VideoRenderPlan;
      }>(
        `/projects/${encodeURIComponent(projectId)}/render-plan/scenes/${encodeURIComponent(sceneId)}/model`,
        {
          method: 'PATCH',
          body: JSON.stringify({ providerId }),
        },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const updateTimeline = useCallback(
    async (timeline: VideoTimeline) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        timeline: VideoTimeline;
      }>(`/projects/${encodeURIComponent(projectId)}/timeline`, {
        method: 'PATCH',
        body: JSON.stringify({ timeline }),
      });
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const applyTimelineOp = useCallback(
    async (input: {
      op: TimelineOp;
      source?: 'user' | 'agent' | 'system';
      summary?: string;
    }) => {
      if (!projectId) return null;
      const data = await videoApi<VideoTimelineOpExecution>(
        `/projects/${encodeURIComponent(projectId)}/timeline/op`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const undoTimelineOp = useCallback(async () => {
    if (!projectId) return null;
    const data = await videoApi<VideoTimelineOpExecution>(
      `/projects/${encodeURIComponent(projectId)}/timeline/undo`,
      { method: 'POST' },
    );
    setProject(data.project);
    return data;
  }, [projectId]);

  const redoTimelineOp = useCallback(async () => {
    if (!projectId) return null;
    const data = await videoApi<VideoTimelineOpExecution>(
      `/projects/${encodeURIComponent(projectId)}/timeline/redo`,
      { method: 'POST' },
    );
    setProject(data.project);
    return data;
  }, [projectId]);

  const applyAgentTool = useCallback(
    async (input: VideoAgentToolCallInput) => {
      if (!projectId) return null;
      const data = await videoApi<VideoAgentToolExecution>(
        `/projects/${encodeURIComponent(projectId)}/agent/tools`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const undoAgentJournalEntry = useCallback(
    async (entryId: string) => {
      if (!projectId) return null;
      const data = await videoApi<VideoAgentToolExecution>(
        `/projects/${encodeURIComponent(projectId)}/agent-journal/${encodeURIComponent(entryId)}/undo`,
        { method: 'POST' },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const redoAgentJournalEntry = useCallback(
    async (entryId: string) => {
      if (!projectId) return null;
      const data = await videoApi<VideoAgentToolExecution>(
        `/projects/${encodeURIComponent(projectId)}/agent-journal/${encodeURIComponent(entryId)}/redo`,
        { method: 'POST' },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const rejectStoryboard = useCallback(async () => {
    if (!projectId) return null;
    const data = await videoApi<{ project: VideoProject }>(
      `/projects/${encodeURIComponent(projectId)}/storyboard/reject`,
      { method: 'POST' },
    );
    setProject(data.project);
    return data.project;
  }, [projectId]);

  const replanScene = useCallback(
    async (sceneId: string, hint?: string) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/storyboard/replan-scene`,
        {
          method: 'POST',
          body: JSON.stringify({ sceneId, hint }),
        },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const materializeSceneAsset = useCallback(
    async (sceneId: string) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        asset: VideoProject['assets'][number];
      }>(
        `/projects/${encodeURIComponent(projectId)}/storyboard/scenes/${encodeURIComponent(sceneId)}/materialize`,
        { method: 'POST' },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const regenerateScene = useCallback(
    async (
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
    ) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        asset: VideoProject['assets'][number];
      }>(
        `/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/regenerate`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const generateMusic = useCallback(
    async (input: VideoMusicPlan) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        asset: VideoProject['assets'][number];
        costCents: number;
      }>(`/projects/${encodeURIComponent(projectId)}/music/generate`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const generateNarration = useCallback(
    async (input: {
      segments?: VideoNarrationSegment[];
      voiceId?: string;
      provider?: string;
    }) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        asset: VideoProject['assets'][number];
        costCents: number;
        segments: VideoNarrationSegment[];
      }>(`/projects/${encodeURIComponent(projectId)}/tts/batch`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const setRenderCaptionMode = useCallback(
    async (renderCaptionMode: VideoCaptionRenderMode) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/settings`,
        {
          method: 'PATCH',
          body: JSON.stringify({ renderCaptionMode }),
        },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const grantLocalFolder = useCallback(async (rootPath: string) => {
    const data = await videoApi<{
      grant: { token: string; rootPath: string; expiresAt: string };
    }>('/local-folder-grants', {
      method: 'POST',
      body: JSON.stringify({ rootPath }),
    });
    return data.grant;
  }, []);

  const addLinkedSource = useCallback(
    async (input: {
      provider: VideoLinkedSourceProvider;
      connectionId?: string;
      rootPath: string;
      displayName?: string;
      role?: VideoLinkedSourceRole;
      filters?: VideoLinkedSource['filters'];
      budget?: VideoLinkedSource['budget'];
      localGrantToken?: string;
    }) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        source: VideoLinkedSource;
      }>(`/projects/${encodeURIComponent(projectId)}/linked-sources`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const syncLinkedSource = useCallback(
    async (sourceId: string) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        source: VideoLinkedSource;
        job: { id: string; status: string };
      }>(
        `/projects/${encodeURIComponent(projectId)}/linked-sources/${encodeURIComponent(sourceId)}/sync`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const removeLinkedSource = useCallback(
    async (sourceId: string) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/linked-sources/${encodeURIComponent(sourceId)}`,
        { method: 'DELETE' },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const listLinkedAssets = useCallback(
    async (
      input: {
        sourceId?: string;
        kind?: VideoLinkedAssetKind;
        query?: string;
        limit?: number;
        offset?: number;
      },
      signal?: AbortSignal,
    ) => {
      if (!projectId) return { assets: [] as VideoLinkedAsset[] };
      const params = new URLSearchParams();
      if (input.sourceId) params.set('sourceId', input.sourceId);
      if (input.kind) params.set('kind', input.kind);
      if (input.query) params.set('q', input.query);
      if (input.limit) params.set('limit', String(input.limit));
      if (input.offset) params.set('offset', String(input.offset));
      return videoApi<{ assets: VideoLinkedAsset[] }>(
        `/projects/${encodeURIComponent(projectId)}/linked-assets?${params.toString()}`,
        { signal },
      );
    },
    [projectId],
  );

  const listLinkedFolderChildren = useCallback(
    async (
      input: {
        sourceId: string;
        path?: string;
        page?: string;
        limit?: number;
        kinds?: VideoLinkedAssetKind[];
      },
      signal?: AbortSignal,
    ) => {
      if (!projectId) {
        return {
          entries: [] as VideoLinkedFolderChild[],
          nextCursor: undefined,
        };
      }
      return videoApi<{
        entries: VideoLinkedFolderChild[];
        nextCursor?: string;
      }>(`/projects/${encodeURIComponent(projectId)}/linked-folders/children`, {
        method: 'POST',
        body: JSON.stringify(input),
        signal,
      });
    },
    [projectId],
  );

  const listRecentLinkedAssets = useCallback(
    async (limit = 24, signal?: AbortSignal) => {
      if (!projectId) return { assets: [] as VideoLinkedAsset[] };
      const params = new URLSearchParams({ limit: String(limit) });
      return videoApi<{ assets: VideoLinkedAsset[] }>(
        `/projects/${encodeURIComponent(projectId)}/linked-assets/recents?${params.toString()}`,
        { signal },
      );
    },
    [projectId],
  );

  const listFavoriteLinkedAssets = useCallback(
    async (limit = 48, signal?: AbortSignal) => {
      if (!projectId) return { assets: [] as VideoLinkedAsset[] };
      const params = new URLSearchParams({ limit: String(limit) });
      return videoApi<{ assets: VideoLinkedAsset[] }>(
        `/projects/${encodeURIComponent(projectId)}/linked-assets/favorites?${params.toString()}`,
        { signal },
      );
    },
    [projectId],
  );

  const setLinkedAssetFavorite = useCallback(
    async (assetId: string, favorite: boolean) => {
      if (!projectId) return null;
      return videoApi<{ asset: VideoLinkedAsset }>(
        `/projects/${encodeURIComponent(projectId)}/linked-assets/${encodeURIComponent(assetId)}/favorite`,
        {
          method: 'POST',
          body: JSON.stringify({ favorite }),
        },
      );
    },
    [projectId],
  );

  const markLinkedAssetOpened = useCallback(
    async (assetId: string) => {
      if (!projectId) return null;
      return videoApi<{ asset: VideoLinkedAsset }>(
        `/projects/${encodeURIComponent(projectId)}/linked-assets/${encodeURIComponent(assetId)}/opened`,
        { method: 'POST', body: JSON.stringify({}) },
      );
    },
    [projectId],
  );

  const searchLinkedAssets = useCallback(
    async (
      input: {
        query?: string;
        kind?: Exclude<VideoLinkedAssetKind, 'other'>;
        sourceIds?: string[];
        role?: VideoLinkedSourceRole;
        durationMs?: { min?: number; max?: number };
        aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5';
        limit?: number;
      },
      signal?: AbortSignal,
    ) => {
      if (!projectId) {
        return {
          results: [] as VideoLinkedAssetSearchHit[],
          capability: {
            vector: false,
            fts: false,
            degraded: true,
            reason: 'project_missing',
          } satisfies VideoLinkedAssetSearchCapability,
        };
      }
      return videoApi<{
        results: VideoLinkedAssetSearchHit[];
        capability: VideoLinkedAssetSearchCapability;
      }>(`/projects/${encodeURIComponent(projectId)}/linked-assets/search`, {
        method: 'POST',
        body: JSON.stringify(input),
        signal,
      });
    },
    [projectId],
  );

  const attachLinkedAsset = useCallback(
    async (assetId: string, sceneId?: string) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        asset: VideoProject['assets'][number];
      }>(
        `/projects/${encodeURIComponent(projectId)}/linked-assets/${encodeURIComponent(assetId)}/attach`,
        {
          method: 'POST',
          body: JSON.stringify({ sceneId, role: 'asset' }),
        },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const attachCatalogAsset = useCallback(
    async (
      assetId: string,
      input?: {
        sessionId?: string;
        // Default is reference-only — picker attaches no bytes; the
        // drop-on-timeline (or render preflight, agent transcode) is
        // what fires `hydrateProjectAsset` later. Callers that need
        // eager behaviour (legacy agent flows) pass 'proxy' or 'full'.
        hydrate?: 'none' | 'proxy' | 'full';
      },
    ) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        asset: VideoProject['assets'][number];
        materialization?: unknown;
      }>(
        `/projects/${encodeURIComponent(projectId)}/assets/catalog/${encodeURIComponent(assetId)}/attach`,
        {
          method: 'POST',
          body: JSON.stringify({
            role: 'b-roll',
            sessionId: input?.sessionId,
            clientRequestId: randomUUID(),
            hydrate: input?.hydrate ?? 'none',
          }),
        },
      );
      setProject((current) =>
        mergeAttachedProjectAsset(current, data.project, data.asset),
      );
      return data;
    },
    [projectId],
  );

  const hydrateProjectAsset = useCallback(
    async (mediaItemId: string, input?: { sessionId?: string }) => {
      if (!projectId) return null;
      const data = await videoApi<{
        project: VideoProject;
        asset: VideoProject['assets'][number];
        materialization?: unknown;
      }>(
        `/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(mediaItemId)}/hydrate`,
        {
          method: 'POST',
          body: JSON.stringify({
            role: 'asset',
            sessionId: input?.sessionId,
            clientRequestId: randomUUID(),
          }),
        },
      );
      setProject(data.project);
      return data;
    },
    [projectId],
  );

  const cancelProjectAssetHydration = useCallback(
    async (mediaItemId: string) => {
      if (!projectId) return false;
      const data = await videoApi<{ cancelled: boolean }>(
        `/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(mediaItemId)}/hydrate`,
        { method: 'DELETE' },
      );
      return data.cancelled;
    },
    [projectId],
  );

  const setFrameNativeEnhancement = useCallback(
    async (
      nodeId: string,
      enabled: boolean,
      nativeTemplateId = 'frame-data-rollup',
    ) => {
      if (!projectId) return null;
      const data = await videoApi<{ project: VideoProject }>(
        `/projects/${encodeURIComponent(projectId)}/content-graph/frames/${encodeURIComponent(nodeId)}/native-enhancement`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled, nativeTemplateId }),
        },
      );
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const applyTemplate = useCallback(
    async (
      templateId: string,
      inputs: Record<string, unknown>,
      name?: string,
    ) => {
      if (!projectId) return null;
      const data = await applyVideoTemplateToProject(projectId, {
        templateId,
        inputs,
        name,
      });
      setProject(data.project);
      return data.project;
    },
    [projectId],
  );

  const renderProject = useCallback(
    async (
      aspectRatio: string,
      options: {
        mode?: 'speed' | 'reproducible';
        renderer?: 'ffmpeg' | 'remotion' | 'webcodecs';
        where?: 'local' | 'cloud';
        renderProviderId?: string;
        cloudEgressConfirmed?: boolean;
        loudnessTargetLufs?: VideoLoudnessTargetLufs;
        autoColor?: boolean;
        autoReframe?: boolean;
        captionMode?: VideoCaptionRenderMode;
      } = {},
    ) => {
      if (!projectId) return null;
      // Optimistically mark the project as rendering so polling kicks in
      // immediately — the /render endpoint blocks until the render is fully
      // complete, so without this the UI would show idle the whole time.
      setProject((prev) =>
        prev
          ? {
              ...prev,
              render: {
                ...(prev.render ?? {}),
                status: 'running',
                progress: 0,
                message: 'Rendering',
                updatedAt: new Date().toISOString(),
              },
            }
          : prev,
      );
      try {
        const data = await videoApi<{ render: VideoProject['render'] }>(
          `/projects/${encodeURIComponent(projectId)}/render`,
          {
            method: 'POST',
            body: JSON.stringify({
              aspectRatios: [aspectRatio],
              mode: options.mode ?? 'speed',
              renderer: options.renderer,
              where: options.where,
              renderProviderId: options.renderProviderId,
              cloudEgressConfirmed: options.cloudEgressConfirmed,
              loudnessTargetLufs: options.loudnessTargetLufs,
              autoColor: options.autoColor,
              autoReframe: options.autoReframe,
              captionMode: options.captionMode,
            }),
          },
        );
        await refresh();
        return data.render;
      } catch (err) {
        await refresh();
        throw err;
      }
    },
    [projectId, refresh],
  );

  const queueRenderProject = useCallback(
    async (
      aspectRatios: string[],
      options: {
        mode?: 'speed' | 'reproducible';
        renderer?: 'ffmpeg' | 'remotion' | 'webcodecs';
        where?: 'local' | 'cloud';
        renderProviderId?: string;
        cloudEgressConfirmed?: boolean;
        loudnessTargetLufs?: VideoLoudnessTargetLufs;
        autoColor?: boolean;
        autoReframe?: boolean;
        captionMode?: VideoCaptionRenderMode;
      } = {},
    ) => {
      if (!projectId) return null;
      const data = await videoApi<{ job: VideoJob }>(
        `/projects/${encodeURIComponent(projectId)}/render-queue`,
        {
          method: 'POST',
          body: JSON.stringify({
            aspectRatios,
            mode: options.mode ?? 'speed',
            renderer: options.renderer,
            where: options.where,
            renderProviderId: options.renderProviderId,
            cloudEgressConfirmed: options.cloudEgressConfirmed,
            loudnessTargetLufs: options.loudnessTargetLufs,
            autoColor: options.autoColor,
            autoReframe: options.autoReframe,
            captionMode: options.captionMode,
          }),
        },
      );
      return data.job;
    },
    [projectId],
  );

  const queueEditorHandoff = useCallback(
    async (input: {
      targets: VideoEditorHandoffTarget[];
      mediaMode?: VideoEditorHandoffMediaMode;
    }) => {
      if (!projectId) return null;
      const data = await videoApi<{ job: VideoJob }>(
        `/projects/${encodeURIComponent(projectId)}/editor-handoff`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      return data.job;
    },
    [projectId],
  );

  const getEditorHandoffJob = useCallback(
    async (jobId: string, signal?: AbortSignal) => {
      if (!projectId) return null;
      return videoApi<VideoEditorHandoffJobStatus>(
        `/projects/${encodeURIComponent(projectId)}/editor-handoff/${encodeURIComponent(jobId)}`,
        { signal },
      );
    },
    [projectId],
  );

  const cancelRender = useCallback(async () => {
    if (!projectId) return null;
    const data = await videoApi<{ render: VideoProject['render'] }>(
      `/projects/${encodeURIComponent(projectId)}/render/cancel`,
      { method: 'POST' },
    );
    await refresh();
    return data.render;
  }, [projectId, refresh]);

  return {
    project,
    loading,
    error,
    refresh,
    patchProject,
    uploadAssets,
    uploadReferenceImages,
    attachAssetPaths,
    deleteAsset,
    regenerateAssetProxy,
    deleteAssetProxy,
    importSourcePath,
    importSourceFile,
    importCaptureFiles,
    importCapturePaths,
    alignCapture,
    queueYtDlpImport,
    analyzeSource,
    createCutPlan,
    generateStoryboard,
    updateStoryboard,
    approveStoryboard,
    createRenderPlan,
    updateRenderPlanSceneModel,
    updateTimeline,
    applyTimelineOp,
    undoTimelineOp,
    redoTimelineOp,
    applyAgentTool,
    undoAgentJournalEntry,
    redoAgentJournalEntry,
    rejectStoryboard,
    replanScene,
    materializeSceneAsset,
    regenerateScene,
    generateMusic,
    generateNarration,
    setRenderCaptionMode,
    grantLocalFolder,
    addLinkedSource,
    syncLinkedSource,
    removeLinkedSource,
    listLinkedAssets,
    listLinkedFolderChildren,
    listRecentLinkedAssets,
    listFavoriteLinkedAssets,
    setLinkedAssetFavorite,
    markLinkedAssetOpened,
    searchLinkedAssets,
    attachLinkedAsset,
    attachCatalogAsset,
    hydrateProjectAsset,
    cancelProjectAssetHydration,
    setFrameNativeEnhancement,
    applyTemplate,
    renderProject,
    queueRenderProject,
    queueEditorHandoff,
    getEditorHandoffJob,
    cancelRender,
    setProject,
  };
}

export async function createVideoProject(input: {
  name: string;
  template: VideoTemplateId;
  prompt?: string;
  aspectRatio?: VideoAspectRatio;
}) {
  return videoApi<{ project: VideoProject }>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function renameVideoProject(projectId: string, name: string) {
  return videoApi<{ project: VideoProject }>(
    `/projects/${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
  );
}

export async function deleteVideoProject(projectId: string) {
  return videoApi<{ ok: boolean }>(
    `/projects/${encodeURIComponent(projectId)}`,
    { method: 'DELETE' },
  );
}

export function useVideoProviders() {
  const [providers, setProviders] = useState<VideoProviderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await videoApi<{ providers: VideoProviderView[] }>(
        '/providers',
        { signal },
      );
      if (!signal?.aborted) {
        setProviders(data.providers);
        setError(null);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  const updateProvider = useCallback(
    async (providerId: string, patch: Record<string, unknown>) => {
      const data = await videoApi<{ provider: VideoProviderView['config'] }>(
        `/providers/${encodeURIComponent(providerId)}`,
        { method: 'PUT', body: JSON.stringify(patch) },
      );
      setProviders((prev) =>
        prev.map((entry) =>
          entry.capability.id === providerId
            ? { ...entry, config: data.provider }
            : entry,
        ),
      );
      return data.provider;
    },
    [],
  );

  const testProvider = useCallback(async (providerId: string) => {
    return videoApi<{ ok: boolean; message: string }>(
      `/providers/${encodeURIComponent(providerId)}/test`,
      { method: 'POST' },
    );
  }, []);

  return { providers, loading, error, refresh, updateProvider, testProvider };
}

export function useVideoRenderProviders() {
  const [providers, setProviders] = useState<VideoRenderProviderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await videoApi<{ providers: VideoRenderProviderView[] }>(
        '/render-providers',
        { signal },
      );
      if (!signal?.aborted) {
        setProviders(data.providers);
        setError(null);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  const upsertProvider = useCallback(
    async (input: {
      id?: string;
      provider: VideoRenderProviderView['provider'];
      label?: string;
      enabled?: boolean;
      baseUrl?: string;
      endpointId?: string;
      apiKey?: string;
      providerSettingId?: string | null;
      rendererImage?: string;
      rendererVersion?: string;
      defaultCostCentsPerRenderSec?: number;
      settings?: Record<string, unknown>;
    }) => {
      const data = await videoApi<{ provider: VideoRenderProviderView }>(
        '/render-providers',
        { method: 'POST', body: JSON.stringify(input) },
      );
      setProviders((prev) => {
        const exists = prev.some((entry) => entry.id === data.provider.id);
        return exists
          ? prev.map((entry) =>
              entry.id === data.provider.id ? data.provider : entry,
            )
          : [...prev, data.provider];
      });
      return data.provider;
    },
    [],
  );

  const testProvider = useCallback(async (providerId: string) => {
    return videoApi<{ ok: boolean; message: string }>(
      `/render-providers/${encodeURIComponent(providerId)}/test`,
      { method: 'POST' },
    );
  }, []);

  return { providers, loading, error, refresh, upsertProvider, testProvider };
}

export function useVideoTemplates() {
  const [templates, setTemplates] = useState<VideoTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await videoApi<{ templates: VideoTemplate[] }>(
        '/templates',
        {
          signal,
        },
      );
      if (!signal?.aborted) {
        setTemplates(data.templates);
        setError(null);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  return { templates, loading, error, refresh };
}

export async function createVideoProjectFromTemplate(input: {
  templateId: string;
  inputs: Record<string, unknown>;
  name?: string;
}) {
  return videoApi<{ project: VideoProject; template: VideoTemplate }>(
    '/projects/from-template',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function applyVideoTemplateToProject(
  projectId: string,
  input: {
    templateId: string;
    inputs: Record<string, unknown>;
    name?: string;
  },
) {
  return videoApi<{ project: VideoProject; template: VideoTemplate }>(
    `/projects/${encodeURIComponent(projectId)}/apply-template`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function saveVideoProjectAsTemplate(
  projectId: string,
  input: {
    displayName: string;
    category?: string;
    license?: 'CC0' | 'CC-BY' | 'proprietary';
  },
) {
  return videoApi<{ template: VideoTemplate }>(
    `/projects/${encodeURIComponent(projectId)}/save-as-template`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}
