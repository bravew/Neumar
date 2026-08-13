import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  StreamTarget,
  type Quality,
  type StreamTargetChunk,
} from 'mediabunny';

import type { VideoClipTransform } from '@/shared/types/video';

import type {
  RemotionAudioClip,
  RemotionCaption,
  RemotionPreviewData,
  RemotionVisualClip,
} from '../remotionPreviewData';
import { renderWebCodecsFrameToCanvas } from '../WebCodecsFrameRenderer';
import { VideoFrameCache } from './VideoFrameCache';
import { WebGLTransitionRenderer } from './WebGLTransitionRenderer';

type ExportQuality = 'low' | 'medium' | 'high' | 'very_high';

export interface WebCodecsExportRequest {
  data: unknown;
  endpoint?: string;
  quality?: ExportQuality;
}

export interface WebCodecsExportResult {
  bytes?: number[];
  bytesWritten: number;
  chunkCount: number;
  frames: number;
  ok: boolean;
}

type RenderHostVisualClip = RemotionVisualClip & {
  transforms?: RemotionVisualClip['transform'];
};

type RenderHostAudioClip = RemotionAudioClip & {
  role?: string;
};

type RenderHostCaption = RemotionCaption & {
  style?: Partial<
    Pick<
      RemotionCaption,
      | 'animation'
      | 'background'
      | 'color'
      | 'fontFamily'
      | 'fontSize'
      | 'fontStyle'
      | 'fontWeight'
      | 'maxWidth'
      | 'position'
      | 'positionX'
      | 'positionY'
      | 'shadowBlur'
      | 'shadowColor'
      | 'shadowOffsetX'
      | 'shadowOffsetY'
      | 'strokeColor'
      | 'strokeWidth'
      | 'textAlign'
      | 'textDecoration'
    >
  >;
};

type RenderHostInput = Omit<
  RemotionPreviewData,
  'audioClips' | 'captions' | 'visualClips'
> & {
  audioClips: RenderHostAudioClip[];
  captions: RenderHostCaption[];
  visualClips: RenderHostVisualClip[];
};

const QUALITY_MAP = {
  high: QUALITY_HIGH,
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  very_high: QUALITY_VERY_HIGH,
} satisfies Record<ExportQuality, Quality>;

export async function exportWebCodecsVideo({
  data,
  endpoint,
  quality = 'high',
}: WebCodecsExportRequest): Promise<WebCodecsExportResult> {
  const exportData = normalizeRenderHostInput(data);
  const canvas = document.createElement('canvas');
  canvas.width = exportData.compositionWidth;
  canvas.height = exportData.compositionHeight;

  let bytesWritten = 0;
  let chunkCount = 0;
  let writeHead = 0;
  const target = endpoint
    ? new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          write: async ({ data: chunk, position }) => {
            if (position !== writeHead) {
              throw new Error(
                `Encoder emitted non-monotonic write: expected ${writeHead}, got ${position}`,
              );
            }
            const response = await fetch(endpoint, {
              body: chunk as BodyInit,
              method: 'POST',
            });
            if (!response.ok) {
              throw new Error(`chunk POST ${response.status}`);
            }
            writeHead = position + chunk.byteLength;
            bytesWritten += chunk.byteLength;
            chunkCount += 1;
          },
        }),
      )
    : new BufferTarget();

  const output = new Output({
    format: new Mp4OutputFormat(endpoint ? { fastStart: 'fragmented' } : {}),
    target,
  });
  const videoSource = new CanvasSource(canvas, {
    bitrate: QUALITY_MAP[quality],
    codec: 'avc',
  });
  output.addVideoTrack(videoSource, { frameRate: exportData.fps });

  const cache = new VideoFrameCache();
  const imageCache = new Map<string, Promise<HTMLImageElement>>();
  const transitionRenderer = new WebGLTransitionRenderer();

  try {
    await output.start();
    for (let frame = 0; frame < exportData.durationInFrames; frame += 1) {
      const rendered = await renderWebCodecsFrameToCanvas({
        cache,
        canvas,
        data: exportData,
        frame,
        imageCache,
        transitionRenderer,
        transformOverrides: EMPTY_TRANSFORMS,
      });
      if (!rendered) {
        throw new Error(`Frame ${frame} did not render`);
      }
      await videoSource.add(frame / exportData.fps, 1 / exportData.fps);
      setExportProgress((frame + 1) / exportData.durationInFrames);
    }
    videoSource.close();
    await output.finalize();
  } finally {
    transitionRenderer.destroy();
    cache.dispose();
    imageCache.clear();
  }

  if (endpoint) {
    return {
      bytesWritten,
      chunkCount,
      frames: exportData.durationInFrames,
      ok: true,
    };
  }

  const buffer = (target as BufferTarget).buffer;
  if (!buffer) {
    throw new Error('Encoder did not produce an output buffer');
  }
  const bytes = [...new Uint8Array(buffer)];
  return {
    bytes,
    bytesWritten: bytes.length,
    chunkCount: bytes.length > 0 ? 1 : 0,
    frames: exportData.durationInFrames,
    ok: true,
  };
}

export function normalizeRenderHostInput(data: unknown): RemotionPreviewData {
  const input = parseRenderHostInput(data);
  return {
    audioClips: input.audioClips.map(normalizeAudioClip),
    captions: input.captions.map(normalizeCaption),
    compositionHeight: input.compositionHeight,
    compositionWidth: input.compositionWidth,
    durationInFrames: input.durationInFrames,
    fps: input.fps,
    introFrames: input.introFrames,
    outroFrames: input.outroFrames,
    visualClips: input.visualClips.map(normalizeVisualClip),
    // Vivid overlays never reach the WebCodecs render host: the final render
    // composites them via the server-side alpha overlay pass (CP4).
    vividOverlays: [],
  };
}

function parseRenderHostInput(data: unknown): RenderHostInput {
  if (!data || typeof data !== 'object') {
    throw new Error('Render host input must be an object');
  }
  const input = data as Partial<RenderHostInput>;
  if (
    !isPositiveFinite(input.compositionWidth) ||
    !isPositiveFinite(input.compositionHeight) ||
    !isPositiveFinite(input.durationInFrames) ||
    !isPositiveFinite(input.fps) ||
    !Array.isArray(input.visualClips) ||
    !Array.isArray(input.audioClips) ||
    !Array.isArray(input.captions)
  ) {
    throw new Error('Render host input is missing required timeline fields');
  }
  return input as RenderHostInput;
}

function normalizeVisualClip(clip: RenderHostVisualClip): RemotionVisualClip {
  const { transforms, ...rest } = clip;
  return {
    ...rest,
    transform: clip.transform ?? transforms,
  };
}

function normalizeAudioClip(clip: RenderHostAudioClip): RemotionAudioClip {
  return clip;
}

function normalizeCaption(caption: RenderHostCaption): RemotionCaption {
  const { style, ...rest } = caption;
  return {
    ...rest,
    ...(style ?? {}),
    position: caption.position ?? style?.position ?? 'bottom',
  };
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function setExportProgress(progress: number): void {
  (
    window as Window & {
      neumaVideoExportProgress?: number;
    }
  ).neumaVideoExportProgress = Math.max(0, Math.min(1, progress));
}

const EMPTY_TRANSFORMS: Record<string, VideoClipTransform> = {};
