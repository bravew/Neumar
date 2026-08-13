import type {
  MaterializeRequest,
  MaterializeResult,
  PreviewArtifactKind,
  ProxyPreset,
} from './materializer-types';
import { AssetsError } from './registry';

export type AssetMaterializeEvent =
  | {
      type: 'materialize.started';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
    }
  | {
      type: 'materialize.progress';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      bytes: number;
      total: number | null;
      percent: number | null;
    }
  | {
      type: 'materialize.complete';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      materializationId: string;
      cacheHit: boolean;
      bytes: number;
    }
  | {
      type: 'materialize.error';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      code: string;
      message: string;
      retryable: boolean;
    }
  | {
      type: 'materialize.cancelled';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
    }
  | {
      type: 'proxy.complete';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      preset: ProxyPreset;
      url: string;
    }
  | {
      type: 'proxy.error';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      preset: ProxyPreset;
      message: string;
      retryable: boolean;
    }
  | {
      type: 'artifact.complete';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      kind: PreviewArtifactKind;
      url: string;
    }
  | {
      type: 'artifact.error';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      kind: PreviewArtifactKind;
      message: string;
      retryable: boolean;
    };

export type AssetMaterializeEventListener = (
  event: AssetMaterializeEvent,
) => void;

const listeners = new Set<AssetMaterializeEventListener>();

export function publishAssetMaterializeEvent(
  event: AssetMaterializeEvent,
): void {
  for (const listener of listeners) listener(event);
}

export function subscribeAssetMaterializeEvents(
  listener: AssetMaterializeEventListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitMaterializeStarted(req: MaterializeRequest): void {
  publishForRequest(req, { type: 'materialize.started' });
}

export function emitMaterializeProgress(
  req: MaterializeRequest,
  bytes: number,
  total: number | null,
): void {
  req.onProgress?.(bytes, total);
  publishForRequest(req, {
    type: 'materialize.progress',
    bytes,
    total,
    percent: total && total > 0 ? Math.min(100, (bytes / total) * 100) : null,
  });
}

export function emitMaterializeComplete(
  req: MaterializeRequest,
  result: MaterializeResult,
): MaterializeResult {
  publishForRequest(req, {
    type: 'materialize.complete',
    materializationId: result.materializationId,
    cacheHit: result.cacheHit,
    bytes: result.bytes,
  });
  return result;
}

export function emitMaterializeError(
  req: MaterializeRequest,
  error: unknown,
): void {
  const status = error instanceof AssetsError ? error.status : 500;
  publishForRequest(req, {
    type: 'materialize.error',
    code: error instanceof AssetsError ? String(error.status) : 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    retryable: isTransientStatus(status),
  });
}

export function emitMaterializeCancelled(req: MaterializeRequest): void {
  publishForRequest(req, { type: 'materialize.cancelled' });
}

export function emitProxyComplete(input: {
  assetId: string;
  scope: string;
  scopeId: string;
  sessionId?: string;
  preset: ProxyPreset;
  url: string;
}): void {
  publishAssetMaterializeEvent({ type: 'proxy.complete', ...input });
}

export function emitProxyError(
  input: {
    assetId: string;
    scope: string;
    scopeId: string;
    sessionId?: string;
    preset: ProxyPreset;
  },
  error: unknown,
): void {
  publishAssetMaterializeEvent({
    type: 'proxy.error',
    ...input,
    message: error instanceof Error ? error.message : String(error),
    retryable: isTransientStatus(
      error instanceof AssetsError ? error.status : 500,
    ),
  });
}

export function emitArtifactComplete(input: {
  assetId: string;
  scope: string;
  scopeId: string;
  sessionId?: string;
  kind: PreviewArtifactKind;
  url: string;
}): void {
  publishAssetMaterializeEvent({ type: 'artifact.complete', ...input });
}

export function emitArtifactError(
  input: {
    assetId: string;
    scope: string;
    scopeId: string;
    sessionId?: string;
    kind: PreviewArtifactKind;
  },
  error: unknown,
): void {
  publishAssetMaterializeEvent({
    type: 'artifact.error',
    ...input,
    message: error instanceof Error ? error.message : String(error),
    retryable: isTransientStatus(
      error instanceof AssetsError ? error.status : 500,
    ),
  });
}

function publishForRequest(
  req: MaterializeRequest,
  event:
    | { type: 'materialize.started' }
    | {
        type: 'materialize.progress';
        bytes: number;
        total: number | null;
        percent: number | null;
      }
    | {
        type: 'materialize.complete';
        materializationId: string;
        cacheHit: boolean;
        bytes: number;
      }
    | {
        type: 'materialize.error';
        code: string;
        message: string;
        retryable: boolean;
      }
    | { type: 'materialize.cancelled' },
): void {
  publishAssetMaterializeEvent({
    assetId: req.assetId,
    scope: req.scope,
    scopeId: req.scopeId,
    sessionId: req.sessionId,
    ...event,
  });
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
