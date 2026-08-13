import type {
  RenderAssetManifestItem,
  RenderProvider,
  RenderProviderCapabilities,
  RenderProviderConfig,
  RenderRequest,
  RenderTaskCreated,
  RenderTaskStatus,
} from '../types';

export class LocalRenderProvider implements RenderProvider {
  readonly id: string;
  readonly name: string;
  readonly kind = 'local' as const;
  readonly capabilities: RenderProviderCapabilities = { ffmpeg: true };

  constructor(private readonly config: RenderProviderConfig) {
    this.id = config.id;
    this.name = config.label || 'Local FFmpeg';
  }

  async uploadAsset(
    localAbsPath: string,
    asset: RenderAssetManifestItem,
  ): Promise<{ remoteUrl: string; sha256: string }> {
    return {
      remoteUrl: `file://${localAbsPath}`,
      sha256: asset.sha256,
    };
  }

  async createRenderTask(req: RenderRequest): Promise<RenderTaskCreated> {
    return {
      providerId: this.id,
      provider: this.name,
      taskId: `local:${req.projectId}`,
      status: 'running',
      estimatedCostUsd: 0,
    };
  }

  async getRenderTaskStatus(taskId: string): Promise<RenderTaskStatus> {
    return {
      providerId: this.id,
      provider: this.name,
      taskId,
      status: 'succeeded',
      progress: 100,
    };
  }

  async cancelRenderTask(): Promise<void> {
    return;
  }

  async downloadResult(): Promise<{ sha256: string; byteCount: number }> {
    throw new Error('Local render results are written by the FFmpeg pipeline');
  }

  async estimateCost(): Promise<{ estimatedCostUsd: number }> {
    return { estimatedCostUsd: 0 };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return {
      ok: this.config.enabled,
      message: this.config.enabled ? 'local-render-enabled' : 'local-disabled',
    };
  }
}
