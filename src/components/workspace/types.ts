import type { AgentMessage } from '@/shared/hooks/useAgent';
import type { PreviewStatus } from '@/shared/hooks/useVitePreview';

import type { Artifact, ArtifactType } from '../artifacts/types';

/** Context passed to workspace canHandle() check */
export interface WorkspaceContext {
  taskId: string;
  messages: AgentMessage[];
  isRunning: boolean;
}

/** Version entry for iterative media editing */
export interface MediaVersion {
  id: string;
  taskId: string;
  artifactId: string;
  versionNumber: number;
  path: string;
  prompt: string;
  previousVersionId?: string;
  type: 'image' | 'video' | 'audio';
  createdAt: string;
}

/** Props passed to all workspace components (standalone — does NOT extend ArtifactPreviewProps) */
export interface WorkspaceProps {
  artifact: Artifact;
  allArtifacts: Artifact[];
  versions: MediaVersion[];
  context: WorkspaceContext;
  onClose: () => void;
  onSelectVersion?: (version: MediaVersion) => void;
  onSendMessage?: (message: string) => void;
}

/** Extended props for DefaultWorkspace which wraps ArtifactPreview and needs live preview props.
 *  Artifact is nullable here because ArtifactPreview handles null (shows empty state). */
export interface DefaultWorkspaceProps extends Omit<
  WorkspaceProps,
  'artifact'
> {
  artifact: Artifact | null;
  livePreviewUrl?: string | null;
  livePreviewStatus?: PreviewStatus;
  livePreviewError?: string | null;
  onStartLivePreview?: () => void;
  onStopLivePreview?: () => void;
}

/** Registration entry for a workspace plugin */
export interface WorkspaceRegistration {
  id: string;
  name: string;
  types: ArtifactType[];
  priority: number;
  component: React.ComponentType<WorkspaceProps>;
  canHandle?: (artifact: Artifact, context: WorkspaceContext) => boolean;
}
