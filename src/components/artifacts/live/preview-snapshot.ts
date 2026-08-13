import { randomUUID } from '@/shared/utils/uuid';

export interface PreviewSnapshot {
  dataUrl: string;
  width: number;
  height: number;
}

const SNAPSHOT_TIMEOUT_MS = 5_000;

export function requestPreviewSnapshot(
  iframe: HTMLIFrameElement | null,
  timeoutMs = SNAPSHOT_TIMEOUT_MS,
): Promise<PreviewSnapshot> {
  const target = iframe?.contentWindow;
  if (!target) {
    return Promise.reject(new Error('Preview frame is not ready.'));
  }
  const requestId = `snapshot-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Preview snapshot timed out.'));
    }, timeoutMs);
    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== target) return;
      const payload = (event.data as { payload?: unknown } | null)?.payload;
      if (!isSnapshotPayload(payload) || payload.requestId !== requestId) {
        return;
      }
      cleanup();
      if (payload.error) {
        reject(new Error(payload.error));
        return;
      }
      resolve({
        dataUrl: payload.dataUrl,
        width: payload.width,
        height: payload.height,
      });
    }
    window.addEventListener('message', onMessage);
    target.postMessage({ type: 'neuma-preview-snapshot', requestId }, '*');
  });
}

export async function exportAsImage(
  filename: string,
  snapshot: PreviewSnapshot,
  options: { drawCanvas?: HTMLCanvasElement | null } = {},
) {
  const dataUrl = options.drawCanvas
    ? await compositeSnapshotWithCanvas(snapshot, options.drawCanvas)
    : snapshot.dataUrl;
  const blob = await dataUrlToBlob(dataUrl);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizePngFilename(filename);
  link.click();
  URL.revokeObjectURL(url);
}

export function sanitizePngFilename(filename: string): string {
  const safe = filename
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const base = safe || 'preview';
  return base.toLowerCase().endsWith('.png') ? base : `${base}.png`;
}

async function compositeSnapshotWithCanvas(
  snapshot: PreviewSnapshot,
  drawCanvas: HTMLCanvasElement,
): Promise<string> {
  const image = await loadImage(snapshot.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return snapshot.dataUrl;
  ctx.drawImage(image, 0, 0, snapshot.width, snapshot.height);
  ctx.drawImage(drawCanvas, 0, 0, snapshot.width, snapshot.height);
  return canvas.toDataURL('image/png');
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Preview snapshot image failed.'));
    image.src = src;
  });
}

function isSnapshotPayload(payload: unknown): payload is {
  kind: 'neuma-preview-snapshot';
  requestId: string;
  dataUrl: string;
  width: number;
  height: number;
  error?: string;
} {
  if (typeof payload !== 'object' || payload === null) return false;
  const value = payload as Record<string, unknown>;
  return (
    value.kind === 'neuma-preview-snapshot' &&
    typeof value.requestId === 'string' &&
    typeof value.dataUrl === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  );
}
