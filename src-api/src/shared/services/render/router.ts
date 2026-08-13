import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';

import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';

import { FalRenderProvider } from './adapters/fal';
import { LocalRenderProvider } from './adapters/local';
import {
  deleteRenderProviderConfig,
  getRenderProviderConfig,
  listRenderProviderConfigs,
  upsertRenderProviderConfig,
  type UpsertRenderProviderConfigInput,
} from './config';
import type {
  RenderAssetManifestItem,
  RenderProvider,
  RenderProviderConfig,
  RenderProviderConfigView,
  RenderRequest,
  RenderTaskStatus,
  RenderWithProviderInput,
} from './types';

const logger = createLogger('RenderRouter');
const CLOUD_RENDER_POLL_INTERVAL_MS = 3000;
const CLOUD_RENDER_TIMEOUT_MS = 30 * 60 * 1000;

export {
  deleteRenderProviderConfig,
  getRenderProviderConfig,
  listRenderProviderConfigs,
  upsertRenderProviderConfig,
};
export type { RenderProviderConfigView, UpsertRenderProviderConfigInput };

export async function renderWithCloudProvider(
  input: RenderWithProviderInput,
): Promise<RenderTaskStatus> {
  if (!isCloudRenderRequest(input.request)) {
    throw new Error(
      'Cloud generation routing is not implemented for aiClip tasks',
    );
  }
  const config = resolveCloudProviderConfig(input.providerId, input.request);
  const provider = createRenderProvider(config);
  assertProviderSupportsRequest(provider, input.request);
  let taskId: string | undefined;

  try {
    await input.onStatus?.({
      status: 'running',
      progress: 5,
      message: `Uploading assets to ${provider.name}`,
      provider: provider.name,
      where: 'cloud',
    });

    const uploadedAssets = await uploadManifest(
      provider,
      input.request.assets,
      input.signal,
    );
    const request = attachUploadedRenderAssets(input.request, uploadedAssets);
    const estimate = await provider.estimateCost?.(request);

    await input.onStatus?.({
      status: 'queued',
      progress: 15,
      message: `Queueing cloud render on ${provider.name}`,
      provider: provider.name,
      where: 'cloud',
    });

    const created = await provider.createRenderTask(request, input.signal);
    taskId = created.taskId;
    await input.onStatus?.({
      status: created.status,
      progress: created.status === 'running' ? 25 : 18,
      message: `Cloud render queued on ${provider.name}`,
      taskId,
      provider: provider.name,
      where: 'cloud',
    });

    const terminal = await pollRenderTask(provider, taskId, {
      signal: input.signal,
      onStatus: input.onStatus,
    });
    if (terminal.status !== 'succeeded') {
      throw new Error(
        terminal.error ?? `Cloud render ${terminal.status} on ${provider.name}`,
      );
    }

    await input.onStatus?.({
      status: 'running',
      progress: 92,
      message: `Downloading cloud render from ${provider.name}`,
      taskId,
      provider: provider.name,
      where: 'cloud',
    });
    const download = await provider.downloadResult(
      terminal,
      input.outputPath,
      input.signal,
    );
    if (terminal.outputSha256 && terminal.outputSha256 !== download.sha256) {
      throw new Error('Cloud render checksum mismatch');
    }

    const finalStatus: RenderTaskStatus = {
      ...terminal,
      outputSha256: terminal.outputSha256 ?? download.sha256,
      unitType: terminal.unitType ?? 'render-second',
      unitCount: terminal.unitCount ?? renderRequestDurationSec(input.request),
      totalCostUsd: terminal.totalCostUsd ?? estimate?.estimatedCostUsd,
      progress: 100,
    };
    await logRenderUsage(input, finalStatus, provider, 'success');
    return finalStatus;
  } catch (error) {
    if (taskId && input.signal?.aborted) {
      await provider.cancelRenderTask(taskId).catch((cancelError) => {
        logger.warn('video.render.cloud_cancel_failed', {
          provider_id: provider.id,
          task_id: taskId,
          error:
            cancelError instanceof Error
              ? cancelError.message
              : String(cancelError),
        });
      });
    }
    await logRenderUsage(input, undefined, provider, 'error', error);
    throw error;
  }
}

export async function testRenderProvider(
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const config = getRenderProviderConfig(id);
  if (!config) return { ok: false, message: 'provider-not-found' };
  return (
    createRenderProvider(config).testConnection?.() ?? {
      ok: config.enabled,
      message: config.enabled ? 'provider-enabled' : 'provider-disabled',
    }
  );
}

export async function createAssetManifestItem(input: {
  localAbsPath: string;
  name: string;
  role: RenderAssetManifestItem['provenance']['role'];
  projectId: string;
  sourcePath: string;
}): Promise<RenderAssetManifestItem> {
  const [stat, sha256] = await Promise.all([
    fs.stat(input.localAbsPath),
    sha256File(input.localAbsPath),
  ]);
  return {
    name: input.name,
    localAbsPath: input.localAbsPath,
    byteCount: stat.size,
    sha256,
    provenance: {
      role: input.role,
      projectId: input.projectId,
      sourcePath: input.sourcePath,
    },
  };
}

function resolveCloudProviderConfig(
  id: string | undefined,
  request: Extract<RenderRequest, { kind: 'ffmpeg' | 'remotion' }>,
): RenderProviderConfig {
  const configs = listRenderProviderConfigs();
  const selectedId =
    id ??
    configs.find(
      (config) =>
        config.provider !== 'local' &&
        config.enabled &&
        config.hasApiKey &&
        renderConfigSupportsKind(config, request.kind),
    )?.id ??
    configs.find(
      (config) =>
        config.provider !== 'local' &&
        config.enabled &&
        renderConfigSupportsKind(config, request.kind),
    )?.id ??
    'fal';
  const config = getRenderProviderConfig(selectedId);
  if (!config) throw new Error(`Render provider "${selectedId}" not found`);
  if (config.provider === 'local') {
    throw new Error('Cloud render requires a cloud render provider');
  }
  if (!config.enabled) {
    throw new Error(`Render provider "${config.label}" is disabled`);
  }
  return config;
}

function renderConfigSupportsKind(
  config: RenderProviderConfigView,
  kind: Extract<RenderRequest, { kind: 'ffmpeg' | 'remotion' }>['kind'],
): boolean {
  if (config.provider === 'local') return false;
  if (config.provider === 'fal') return true;
  if (config.provider === 'modal') return kind === 'ffmpeg';
  return false;
}

function createRenderProvider(config: RenderProviderConfig): RenderProvider {
  switch (config.provider) {
    case 'local':
      return new LocalRenderProvider(config);
    case 'fal':
      return new FalRenderProvider(config);
    case 'modal':
    case 'replicate':
      throw new Error(
        `${config.label} render provider is listed for configuration but not implemented yet`,
      );
  }
}

async function uploadManifest(
  provider: RenderProvider,
  assets: RenderAssetManifestItem[],
  signal?: AbortSignal,
): Promise<RenderAssetManifestItem[]> {
  const uploaded: RenderAssetManifestItem[] = [];
  for (const asset of assets) {
    const result = await provider.uploadAsset(
      asset.localAbsPath,
      asset,
      signal,
    );
    if (result.sha256 !== asset.sha256) {
      throw new Error(`Checksum mismatch while uploading ${asset.name}`);
    }
    uploaded.push({
      ...asset,
      remoteUrl: result.remoteUrl,
      ttlExpiresAt: result.ttlExpiresAt,
    });
  }
  return uploaded;
}

export function attachUploadedRenderAssets(
  request: RenderRequest,
  assets: RenderAssetManifestItem[],
): RenderRequest {
  if (request.kind === 'ffmpeg') return { ...request, assets };
  if (request.kind !== 'remotion') return request;
  return {
    ...request,
    assets,
    bundle: {
      ...request.bundle,
      inputProps: remotionInputPropsWithUploadedUrls(
        request.bundle.inputProps,
        assets,
      ),
    },
  };
}

function remotionInputPropsWithUploadedUrls(
  inputProps: Record<string, unknown>,
  assets: RenderAssetManifestItem[],
): Record<string, unknown> {
  const remoteUrlBySourcePath = new Map(
    assets
      .filter((asset) => asset.remoteUrl)
      .map((asset) => [asset.provenance.sourcePath, asset.remoteUrl as string]),
  );
  return {
    ...inputProps,
    visualClips: remotionClipsWithUploadedUrls(
      inputProps.visualClips,
      remoteUrlBySourcePath,
    ),
    audioClips: remotionClipsWithUploadedUrls(
      inputProps.audioClips,
      remoteUrlBySourcePath,
    ),
  };
}

function remotionClipsWithUploadedUrls(
  clips: unknown,
  remoteUrlBySourcePath: Map<string, string>,
): unknown {
  if (!Array.isArray(clips)) return clips;
  return clips.map((clip) => {
    if (!clip || typeof clip !== 'object') return clip;
    const record = clip as Record<string, unknown>;
    const sourcePath =
      typeof record.sourcePath === 'string' ? record.sourcePath : undefined;
    if (!sourcePath) return clip;
    const remoteUrl = remoteUrlBySourcePath.get(sourcePath);
    if (!remoteUrl) {
      const src = typeof record.src === 'string' ? record.src : undefined;
      if (src?.startsWith('file:')) {
        throw new Error(
          `Uploaded asset URL missing for Remotion source ${sourcePath}`,
        );
      }
      return clip;
    }
    return { ...record, src: remoteUrl };
  });
}

async function pollRenderTask(
  provider: RenderProvider,
  taskId: string,
  options: Pick<RenderWithProviderInput, 'signal' | 'onStatus'>,
): Promise<RenderTaskStatus> {
  const startedAt = Date.now();
  while (true) {
    if (options.signal?.aborted) {
      await provider.cancelRenderTask(taskId);
      return {
        providerId: provider.id,
        provider: provider.name,
        taskId,
        status: 'cancelled',
      };
    }
    if (Date.now() - startedAt > CLOUD_RENDER_TIMEOUT_MS) {
      await provider.cancelRenderTask(taskId);
      return {
        providerId: provider.id,
        provider: provider.name,
        taskId,
        status: 'failed',
        error: `Timed out waiting for cloud render ${taskId}`,
      };
    }

    await wait(cloudPollIntervalMs(), options.signal);
    const status = await provider.getRenderTaskStatus(taskId, options.signal);
    await options.onStatus?.({
      status:
        status.status === 'queued' || status.status === 'running'
          ? status.status
          : 'running',
      progress: status.progress,
      message: cloudStatusMessage(provider.name, status.status),
      taskId,
      provider: provider.name,
      where: 'cloud',
    });

    if (
      status.status === 'succeeded' ||
      status.status === 'failed' ||
      status.status === 'cancelled'
    ) {
      return status;
    }
  }
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function cloudPollIntervalMs(): number {
  const override = Number(
    process.env.NEUMA_VIDEO_CLOUD_RENDER_POLL_INTERVAL_MS,
  );
  return Number.isFinite(override) && override >= 0
    ? override
    : CLOUD_RENDER_POLL_INTERVAL_MS;
}

function cloudStatusMessage(provider: string, status: string): string {
  switch (status) {
    case 'queued':
      return `Cloud render queued on ${provider}`;
    case 'running':
      return `Cloud render running on ${provider}`;
    case 'succeeded':
      return `Cloud render complete on ${provider}`;
    case 'cancelled':
      return `Cloud render cancelled on ${provider}`;
    default:
      return `Cloud render failed on ${provider}`;
  }
}

async function logRenderUsage(
  input: RenderWithProviderInput,
  status: RenderTaskStatus | undefined,
  provider: RenderProvider,
  logStatus: 'success' | 'error',
  error?: unknown,
): Promise<void> {
  if (!isCloudRenderRequest(input.request)) return;
  const durationSec = renderRequestDurationSec(input.request);
  if (durationSec === undefined) return;
  await logUsage({
    callType: 'render',
    provider: provider.name,
    model: input.request.kind,
    totalCostUsd: status?.totalCostUsd,
    unitType: status?.unitType ?? 'render-second',
    unitCount: status?.unitCount ?? durationSec,
    status: logStatus,
    errorMessage: error instanceof Error ? error.message : undefined,
    metadata: {
      project_id: input.request.projectId,
      render_mode: 'cloud',
      render_kind: input.request.kind,
      aspect_ratio: input.request.graph.aspectRatio,
      scenes_count: input.request.graph.scenes.length,
    },
  });
}

function isCloudRenderRequest(
  request: RenderRequest,
): request is Extract<RenderRequest, { kind: 'ffmpeg' | 'remotion' }> {
  return request.kind === 'ffmpeg' || request.kind === 'remotion';
}

function assertProviderSupportsRequest(
  provider: RenderProvider,
  request: Extract<RenderRequest, { kind: 'ffmpeg' | 'remotion' }>,
): void {
  if (request.kind === 'ffmpeg' && !provider.capabilities.ffmpeg) {
    throw new Error(`${provider.name} does not support FFmpeg cloud renders`);
  }
  if (request.kind === 'remotion' && !provider.capabilities.remotion) {
    throw new Error(`${provider.name} does not support Remotion cloud renders`);
  }
}

function renderRequestDurationSec(request: RenderRequest): number | undefined {
  if (request.kind === 'ffmpeg' || request.kind === 'remotion') {
    return request.graph.totalDurationSec;
  }
  return undefined;
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
