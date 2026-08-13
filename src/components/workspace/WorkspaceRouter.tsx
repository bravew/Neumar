import { Suspense, useCallback, useMemo } from 'react';

import { ErrorBoundary } from 'react-error-boundary';

import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import type { PreviewStatus } from '@/shared/hooks/useVitePreview';

import type { Artifact } from '../artifacts/types';
import { DefaultWorkspace } from './DefaultWorkspace';
import { resolveWorkspace } from './registry';
import type { MediaVersion, WorkspaceContext, WorkspaceProps } from './types';

export interface WorkspaceRouterProps {
  artifact: Artifact | null;
  allArtifacts: Artifact[];
  versions: MediaVersion[];
  context: WorkspaceContext;
  onClose: () => void;
  onSelectVersion?: (version: MediaVersion) => void;
  onSendMessage?: (message: string) => void;
  // Live preview props (only forwarded to DefaultWorkspace)
  livePreviewUrl?: string | null;
  livePreviewStatus?: PreviewStatus;
  livePreviewError?: string | null;
  onStartLivePreview?: () => void;
  onStopLivePreview?: () => void;
}

function WorkspaceErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: unknown;
  resetErrorBoundary: () => void;
}) {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <p className="text-muted-foreground mb-2 text-sm">
        Failed to load workspace
      </p>
      <p className="text-muted-foreground/70 mb-4 text-xs">{message}</p>
      <button
        onClick={resetErrorBoundary}
        className="text-primary text-sm hover:underline"
      >
        Try again
      </button>
    </div>
  );
}

function WorkspaceLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <AILoadingIndicator size="md" />
    </div>
  );
}

export function WorkspaceRouter({
  artifact,
  allArtifacts,
  versions,
  context,
  onClose,
  onSelectVersion,
  onSendMessage,
  livePreviewUrl,
  livePreviewStatus,
  livePreviewError,
  onStartLivePreview,
  onStopLivePreview,
}: WorkspaceRouterProps) {
  // Resolve workspace registration based on artifact type + id.
  // `context` is intentionally excluded: resolution depends only on artifact type/id,
  // and no current canHandle() uses context. If a future workspace needs context-based
  // resolution, add the relevant context primitives to this dependency array.
  const registration = useMemo(() => {
    if (!artifact) return null;
    return resolveWorkspace(artifact, context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact?.type, artifact?.id]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSelectVersion = useCallback(
    (version: MediaVersion) => {
      onSelectVersion?.(version);
    },
    [onSelectVersion],
  );

  const handleSendMessage = useCallback(
    (message: string) => {
      onSendMessage?.(message);
    },
    [onSendMessage],
  );

  // No artifact selected — DefaultWorkspace/ArtifactPreview handles null (shows empty state)
  if (!artifact) {
    return (
      <DefaultWorkspace
        artifact={null}
        allArtifacts={allArtifacts}
        versions={[]}
        context={context}
        onClose={handleClose}
        livePreviewUrl={livePreviewUrl}
        livePreviewStatus={livePreviewStatus}
        livePreviewError={livePreviewError}
        onStartLivePreview={onStartLivePreview}
        onStopLivePreview={onStopLivePreview}
      />
    );
  }

  // Matched a registered workspace — render it
  if (registration) {
    const Component = registration.component;
    const workspaceProps: WorkspaceProps = {
      artifact,
      allArtifacts,
      versions,
      context,
      onClose: handleClose,
      onSelectVersion: handleSelectVersion,
      onSendMessage: handleSendMessage,
    };

    return (
      <ErrorBoundary
        FallbackComponent={WorkspaceErrorFallback}
        resetKeys={[artifact.id, registration.id]}
      >
        <Suspense fallback={<WorkspaceLoadingFallback />}>
          <Component {...workspaceProps} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  // No matching workspace — fall back to DefaultWorkspace (wraps ArtifactPreview)
  return (
    <DefaultWorkspace
      artifact={artifact}
      allArtifacts={allArtifacts}
      versions={versions}
      context={context}
      onClose={handleClose}
      onSelectVersion={handleSelectVersion}
      onSendMessage={handleSendMessage}
      livePreviewUrl={livePreviewUrl}
      livePreviewStatus={livePreviewStatus}
      livePreviewError={livePreviewError}
      onStartLivePreview={onStartLivePreview}
      onStopLivePreview={onStopLivePreview}
    />
  );
}
