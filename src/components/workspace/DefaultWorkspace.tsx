import { ArtifactPreview } from '@/components/artifacts';

import type { DefaultWorkspaceProps } from './types';

export function DefaultWorkspace({
  artifact,
  allArtifacts,
  onClose,
  livePreviewUrl,
  livePreviewStatus,
  livePreviewError,
  onStartLivePreview,
  onStopLivePreview,
}: DefaultWorkspaceProps) {
  return (
    <ArtifactPreview
      artifact={artifact}
      onClose={onClose}
      allArtifacts={allArtifacts}
      livePreviewUrl={livePreviewUrl}
      livePreviewStatus={livePreviewStatus}
      livePreviewError={livePreviewError}
      onStartLivePreview={onStartLivePreview}
      onStopLivePreview={onStopLivePreview}
    />
  );
}
