/**
 * WorkspacePanel — Container with mode tabs wrapping workspace content.
 * Modes: Preview (artifact preview), Files (file tree), Diff (file diffs), Trace.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

import type { Artifact } from '@/components/artifacts/types';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import { TraceViewer } from '@/components/task/trace/TraceViewer';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import type { AgentMessage } from '@/shared/hooks/agent-types';
import type { PreviewStatus } from '@/shared/hooks/useVitePreview';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { MediaVersion, WorkspaceContext } from './types';
import type { DiffEntry } from './WorkspaceDiffView';
import { WorkspaceFileTree } from './WorkspaceFileTree';
import { WorkspaceRouter } from './WorkspaceRouter';

// Lazy-load diff view to avoid bundle impact
const WorkspaceDiffView = lazy(() =>
  import('./WorkspaceDiffView').then((m) => ({ default: m.WorkspaceDiffView })),
);

export type WorkspaceMode = 'preview' | 'files' | 'diff' | 'trace';

interface WorkspacePanelProps {
  // Workspace router props
  artifact: Artifact | null;
  allArtifacts: Artifact[];
  versions: MediaVersion[];
  context: WorkspaceContext;
  onClose: () => void;
  onSelectVersion?: (version: MediaVersion) => void;
  onSendMessage?: (message: string) => void;
  livePreviewUrl?: string | null;
  livePreviewStatus?: PreviewStatus;
  livePreviewError?: string | null;
  onStartLivePreview?: () => void;
  onStopLivePreview?: () => void;
  // File tree props
  workDir?: string;
  onSelectFile?: (filePath: string, fileName: string) => void;
  // Diff props
  diffs?: DiffEntry[];
  // Trace props
  messages?: (AgentMessage | AGUIMessage)[];
  isRunning?: boolean;
  taskId?: string;
}

const MODES: WorkspaceMode[] = ['preview', 'files', 'diff', 'trace'];

export function WorkspacePanel(props: WorkspacePanelProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<WorkspaceMode>(
    props.artifact ? 'preview' : 'files',
  );

  // Auto-switch to preview when an artifact is selected
  useEffect(() => {
    if (props.artifact) setMode('preview');
  }, [props.artifact]);

  const modeLabels = useMemo<Record<WorkspaceMode, string>>(
    () => ({
      preview: t.task.workspacePreview,
      files: t.task.workspaceFiles,
      diff: t.task.workspaceDiff,
      trace: t.task.trace,
    }),
    [t],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="border-border/40 flex shrink-0 items-center gap-0.5 border-b px-2">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              'px-2.5 py-1.5 text-xs font-medium transition-colors',
              mode === m
                ? 'border-primary text-foreground border-b-2'
                : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent',
            )}
          >
            {modeLabels[m]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'preview' &&
          (props.artifact ? (
            <WorkspaceRouter
              artifact={props.artifact}
              allArtifacts={props.allArtifacts}
              versions={props.versions}
              context={props.context}
              onClose={props.onClose}
              onSelectVersion={props.onSelectVersion}
              onSendMessage={props.onSendMessage}
              livePreviewUrl={props.livePreviewUrl}
              livePreviewStatus={props.livePreviewStatus}
              livePreviewError={props.livePreviewError}
              onStartLivePreview={props.onStartLivePreview}
              onStopLivePreview={props.onStopLivePreview}
            />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-sm">
              <span>{t.task.selectArtifactToPreview}</span>
            </div>
          ))}

        {mode === 'files' && props.workDir && (
          <WorkspaceFileTree
            workDir={props.workDir}
            onSelectFile={props.onSelectFile}
          />
        )}

        {mode === 'files' && !props.workDir && (
          <div className="text-muted-foreground flex items-center justify-center p-8 text-sm">
            {t.task.noFilesInWorkspace}
          </div>
        )}

        {mode === 'diff' && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <AILoadingIndicator size="md" />
              </div>
            }
          >
            <WorkspaceDiffView diffs={props.diffs ?? []} />
          </Suspense>
        )}

        {mode === 'trace' && (
          <TraceViewer
            messages={props.messages ?? []}
            isRunning={props.isRunning ?? false}
            taskId={props.taskId}
          />
        )}
      </div>
    </div>
  );
}
