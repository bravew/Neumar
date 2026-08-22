import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ContentGraphViewer } from '@/components/video/ContentGraphViewer';
import { VideoFramesStrip } from '@/components/video/VideoFramesStrip';
import { useVideoProject } from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import { useContentGraph } from '@/shared/video/useContentGraph';

import { useRenderQueueJobs } from '../useRenderQueueJobs';
import { HyperframesStudioPreview } from './HyperframesStudioPreview';

// Slice K — the multi-frame agent output: a topo-ordered frames strip (editable)
// + the read-only content-graph viewer. Hidden until the agent emits a graph.

export function HtmlVideoFrames({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const { graph, save } = useContentGraph(projectId);
  const { project, refresh, setFrameNativeEnhancement } =
    useVideoProject(projectId);
  const { jobs } = useRenderQueueJobs(projectId, { enabled: Boolean(graph) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enhancingNodeId, setEnhancingNodeId] = useState<string | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const lastTerminalJobKeyRef = useRef('');
  const terminalJobKey = useMemo(
    () =>
      jobs
        .filter(
          (job) =>
            job.status === 'done' ||
            job.status === 'error' ||
            job.status === 'cancelled',
        )
        .map((job) => `${job.id}:${job.status}:${job.finishedAt ?? ''}`)
        .join('|'),
    [jobs],
  );

  useEffect(() => {
    if (!terminalJobKey || terminalJobKey === lastTerminalJobKeyRef.current) {
      return;
    }
    lastTerminalJobKeyRef.current = terminalJobKey;
    void refresh();
  }, [refresh, terminalJobKey]);

  const toggleNativeEnhancement = useCallback(
    async (nodeId: string, enabled: boolean) => {
      setEnhancingNodeId(nodeId);
      setEnhanceError(null);
      try {
        await setFrameNativeEnhancement(nodeId, enabled);
      } catch (err) {
        setEnhanceError(err instanceof Error ? err.message : String(err));
      } finally {
        setEnhancingNodeId(null);
      }
    },
    [setFrameNativeEnhancement],
  );

  if (!graph || graph.nodes.length === 0) return null;

  const nativeEnhancedNodeIds =
    project?.storyboard?.scenes.flatMap((scene) => {
      const seed = scene.htmlFrameSeed;
      return seed?.renderOverride?.mode === 'native' ? [seed.nodeId] : [];
    }) ?? [];

  return (
    <div className="space-y-3">
      <h3 className="text-foreground text-sm font-medium">
        {t.video.htmlGallery.framesTitle}
      </h3>
      {enhanceError ? (
        <p className="text-destructive text-xs" role="alert">
          {t.video.framesStrip.enhanceError.replace('{error}', enhanceError)}
        </p>
      ) : null}
      <VideoFramesStrip
        graph={graph}
        onSave={save}
        selectedId={selectedId}
        onSelect={setSelectedId}
        nativeEnhancedNodeIds={nativeEnhancedNodeIds}
        enhancingNodeId={enhancingNodeId}
        onSetNativeEnhancement={toggleNativeEnhancement}
      />
      {selectedId ? (
        <HyperframesStudioPreview
          projectId={projectId}
          selectedFrameId={selectedId}
        />
      ) : null}
      <ContentGraphViewer
        graph={graph}
        projectId={projectId}
        jobs={jobs}
        agentJournal={project?.agentJournal ?? []}
        renderStatus={project?.render}
        outputs={project?.outputs ?? []}
      />
    </div>
  );
}
