import fs from 'node:fs/promises';

import { safeFetch } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';

import type {
  RenderAssetManifestItem,
  RenderProvider,
  RenderProviderCapabilities,
  RenderProviderConfig,
  RenderRequest,
  RenderTaskCreated,
  RenderTaskState,
  RenderTaskStatus,
} from '../types';

interface FalQueueStatusBody {
  request_id?: string;
  requestId?: string;
  status?: string;
}

interface FalResultBody {
  response?: FalResultBody;
  video?: { url?: string; sha256?: string };
  output?: { url?: string; sha256?: string };
  result?: { url?: string; sha256?: string };
  url?: string;
  sha256?: string;
  metrics?: { total_cost_usd?: number; duration_seconds?: number };
}

const DEFAULT_FAL_REQUEST_TIMEOUT_MS = 120_000;
const FAL_CANCEL_TIMEOUT_MS = 30_000;

export class FalRenderProvider implements RenderProvider {
  readonly id: string;
  readonly name: string;
  readonly kind = 'fal' as const;
  readonly capabilities: RenderProviderCapabilities = {
    ffmpeg: true,
    remotion: true,
    seedance: true,
    veo: true,
  };

  private readonly resultUrls = new Map<
    string,
    { url: string; sha256?: string }
  >();

  constructor(private readonly config: RenderProviderConfig) {
    this.id = config.id;
    this.name = config.label || 'fal.ai';
  }

  async uploadAsset(
    localAbsPath: string,
    asset: RenderAssetManifestItem,
    signal?: AbortSignal,
  ): Promise<{ remoteUrl: string; sha256: string; ttlExpiresAt?: string }> {
    if (this.isMock()) {
      return {
        remoteUrl: `mock://fal/assets/${encodeURIComponent(asset.name)}`,
        sha256: asset.sha256,
        ttlExpiresAt: ttl(60),
      };
    }

    const uploadUrl = stringSetting(this.config.settings.assetUploadUrl);
    if (!uploadUrl) {
      throw new Error(
        'fal.ai cloud render requires a configured assetUploadUrl for the private renderer endpoint.',
      );
    }

    const bytes = await fs.readFile(localAbsPath);
    const response = await fetchWithTimeout(
      uploadUrl,
      {
        method: 'POST',
        headers: {
          authorization: `Key ${this.requireApiKey()}`,
          'content-type': 'application/octet-stream',
          'x-neuma-asset-name': asset.name,
          'x-neuma-asset-sha256': asset.sha256,
        },
        body: bytes,
      },
      signal,
    );
    const body = await parseJson(response);
    if (!response.ok) {
      throw new Error(
        `fal.ai asset upload failed: HTTP ${response.status} ${errorMessage(body)}`,
      );
    }
    const remoteUrl =
      readString(body, 'url') ??
      readString(body, 'remoteUrl') ??
      readString(body, 'file_url');
    if (!remoteUrl) {
      throw new Error('fal.ai asset upload did not return a remote URL');
    }
    return {
      remoteUrl,
      sha256: readString(body, 'sha256') ?? asset.sha256,
      ttlExpiresAt: readString(body, 'ttlExpiresAt') ?? ttl(60),
    };
  }

  async createRenderTask(
    req: RenderRequest,
    signal?: AbortSignal,
  ): Promise<RenderTaskCreated> {
    if (this.isMock()) {
      return {
        providerId: this.id,
        provider: this.name,
        taskId: `fal-mock-${req.projectId}`,
        status: 'queued',
        estimatedCostUsd: this.estimateCostSync(req),
        estimatedTimeSec: renderDurationSec(req),
      };
    }

    const response = await fetchWithTimeout(
      this.queueUrl(),
      {
        method: 'POST',
        headers: {
          authorization: `Key ${this.requireApiKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          input: req,
        }),
      },
      signal,
    );
    const body = (await parseJson(response)) as FalQueueStatusBody;
    if (!response.ok) {
      throw new Error(
        `fal.ai render queue failed: HTTP ${response.status} ${errorMessage(body)}`,
      );
    }
    const taskId = body.request_id ?? body.requestId;
    if (!taskId)
      throw new Error('fal.ai render queue did not return request_id');
    return {
      providerId: this.id,
      provider: this.name,
      taskId,
      status:
        normalizeFalStatus(body.status) === 'running' ? 'running' : 'queued',
      estimatedCostUsd: this.estimateCostSync(req),
      estimatedTimeSec: renderDurationSec(req),
    };
  }

  async getRenderTaskStatus(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<RenderTaskStatus> {
    if (this.isMock()) {
      this.resultUrls.set(taskId, { url: 'mock://fal/result.mp4' });
      return {
        providerId: this.id,
        provider: this.name,
        taskId,
        status: 'succeeded',
        progress: 100,
        resultUrl: 'mock://fal/result.mp4',
      };
    }

    const response = await fetchWithTimeout(
      `${this.queueUrl()}/requests/${taskId}/status`,
      {
        headers: { authorization: `Key ${this.requireApiKey()}` },
      },
      signal,
    );
    const body = (await parseJson(response)) as FalQueueStatusBody;
    if (!response.ok) {
      return {
        providerId: this.id,
        provider: this.name,
        taskId,
        status: 'failed',
        error: `fal.ai status failed: HTTP ${response.status} ${errorMessage(body)}`,
      };
    }

    const status = normalizeFalStatus(body.status);
    if (status !== 'succeeded') {
      return {
        providerId: this.id,
        provider: this.name,
        taskId,
        status,
        progress: status === 'running' ? 50 : 20,
      };
    }

    const result = await this.fetchResult(taskId, signal);
    return {
      providerId: this.id,
      provider: this.name,
      taskId,
      status: 'succeeded',
      progress: 100,
      resultUrl: result.url,
      outputSha256: result.sha256,
      totalCostUsd: result.totalCostUsd,
      unitType: 'render-second',
      unitCount: result.durationSec,
    };
  }

  async cancelRenderTask(taskId: string, signal?: AbortSignal): Promise<void> {
    if (this.isMock()) return;
    await fetchWithTimeout(
      `${this.queueUrl()}/requests/${taskId}/cancel`,
      {
        method: 'PUT',
        headers: { authorization: `Key ${this.requireApiKey()}` },
      },
      signal?.aborted ? undefined : signal,
      FAL_CANCEL_TIMEOUT_MS,
    );
  }

  async downloadResult(
    task: RenderTaskStatus,
    destAbsPath: string,
    signal?: AbortSignal,
  ): Promise<{ sha256: string; byteCount: number }> {
    if (this.isMock()) {
      const bytes = Buffer.from('mock fal cloud render');
      await fs.writeFile(destAbsPath, bytes);
      return { sha256: task.outputSha256 ?? '', byteCount: bytes.byteLength };
    }

    const resultUrl = task.resultUrl ?? this.resultUrls.get(task.taskId)?.url;
    if (!resultUrl) {
      throw new Error(
        `fal.ai task ${task.taskId} has no downloadable result URL`,
      );
    }
    const response = await safeFetch(resultUrl, trustedLocalPolicy(), {
      timeoutMs: 120_000,
      signal,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`fal.ai result download failed: HTTP ${response.status}`);
    }
    await fs.writeFile(destAbsPath, response.body);
    return {
      sha256: task.outputSha256 ?? '',
      byteCount: response.body.byteLength,
    };
  }

  async estimateCost(req: RenderRequest): Promise<{
    estimatedCostUsd?: number;
    estimatedTimeSec?: number;
  }> {
    return {
      estimatedCostUsd: this.estimateCostSync(req),
      estimatedTimeSec: renderDurationSec(req),
    };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (this.isMock()) return { ok: true, message: 'fal-mock-ready' };
    if (!this.config.endpointId) {
      return { ok: false, message: 'missing-endpoint-id' };
    }
    if (!this.config.apiKey) {
      return { ok: false, message: 'missing-api-key' };
    }
    return { ok: true, message: 'fal-provider-configured' };
  }

  private async fetchResult(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<{
    url: string;
    sha256?: string;
    totalCostUsd?: number;
    durationSec?: number;
  }> {
    const response = await fetchWithTimeout(
      `${this.queueUrl()}/requests/${taskId}`,
      {
        headers: { authorization: `Key ${this.requireApiKey()}` },
      },
      signal,
    );
    const body = (await parseJson(response)) as FalResultBody;
    if (!response.ok) {
      throw new Error(
        `fal.ai result lookup failed: HTTP ${response.status} ${errorMessage(body)}`,
      );
    }
    const responseBody = body.response ?? body;
    const output =
      responseBody.video ??
      responseBody.output ??
      responseBody.result ??
      responseBody;
    const url = output.url;
    if (!url)
      throw new Error('fal.ai render result did not include a video URL');
    const result = {
      url,
      sha256: output.sha256,
      totalCostUsd: body.metrics?.total_cost_usd,
      durationSec: body.metrics?.duration_seconds,
    };
    this.resultUrls.set(taskId, result);
    return result;
  }

  private queueUrl(): string {
    const baseUrl = (this.config.baseUrl ?? 'https://queue.fal.run').replace(
      /\/+$/,
      '',
    );
    const endpointId = this.config.endpointId?.replace(/^\/+|\/+$/g, '');
    if (!endpointId)
      throw new Error('fal.ai render provider missing endpointId');
    return `${baseUrl}/${endpointId}`;
  }

  private requireApiKey(): string {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error('fal.ai render provider missing API key');
    return apiKey;
  }

  private isMock(): boolean {
    return this.config.baseUrl?.startsWith('mock://') ?? false;
  }

  private estimateCostSync(req: RenderRequest): number | undefined {
    const durationSec = renderDurationSec(req);
    if (durationSec === undefined) return undefined;
    const cents = this.config.defaultCostCentsPerRenderSec;
    if (typeof cents !== 'number' || cents <= 0) return undefined;
    return Number(((durationSec * cents) / 100).toFixed(4));
  }
}

function renderDurationSec(req: RenderRequest): number | undefined {
  if (req.kind === 'ffmpeg' || req.kind === 'remotion') {
    return req.graph.totalDurationSec;
  }
  return undefined;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function normalizeFalStatus(status: string | undefined): RenderTaskState {
  const normalized = status?.toLowerCase();
  if (
    normalized === 'completed' ||
    normalized === 'succeeded' ||
    normalized === 'success'
  ) {
    return 'succeeded';
  }
  if (
    normalized === 'in_progress' ||
    normalized === 'in-progress' ||
    normalized === 'running'
  ) {
    return 'running';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'cancelled';
  }
  if (normalized === 'failed' || normalized === 'error') return 'failed';
  return 'queued';
}

function errorMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return (
    readString(record, 'error') ??
    readString(record, 'message') ??
    readString(record, 'detail') ??
    ''
  );
}

function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return typeof record[key] === 'string' ? record[key] : undefined;
}

function stringSetting(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_FAL_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const requestSignal = createRequestSignal(signal, timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: requestSignal.signal,
    });
  } finally {
    requestSignal.cleanup();
  }
}

function createRequestSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function ttl(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
