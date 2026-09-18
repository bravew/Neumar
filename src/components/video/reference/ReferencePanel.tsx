import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoReference } from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { PanelShell } from '../PanelShell';
import { ReferenceAddForm } from './ReferenceAddForm';
import { ReferenceCard } from './ReferenceCard';
import { ReferenceResultsView } from './ReferenceResultsView';
import { useReferenceRunPolling } from './useReferenceRunPolling';
import {
  blockedSteps,
  pendingAgentSteps,
  runIsActive,
  systemStepsSettled,
  useReferenceStudyStore,
} from './useReferenceStudyStore';

interface ReferencePanelProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  flagsLoading: boolean;
  flagsError: string | null;
  onRetryFlags: () => void;
}

/**
 * Analyze video tab — the one surface that owns a reference study.
 *
 * Adding, analyzing, cancelling, progress, and the jump into results all live
 * here. The pipeline's `read` and `extract` steps are agent-owned, so when a
 * run reaches them the panel asks the chat dock to finish the job through the
 * shared study store; the dock sends that as a visible turn, which is what
 * connects this panel to the conversation on the left.
 */
export function ReferencePanel({
  project,
  actions,
  flagsLoading,
  flagsError,
  onRetryFlags,
}: ReferencePanelProps) {
  const { t } = useLanguage();
  const labels = t.video.reference;
  const [focusText, setFocusText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  // Drill-down target. The results live in this rail, not over it, so the
  // editor and the chat stay reachable while a reading is open.
  const [openedId, setOpenedId] = useState<string | null>(null);
  const references = useMemo(
    () => project.videoReferences ?? [],
    [project.videoReferences],
  );
  const actionsEnabled = !flagsLoading && !flagsError;

  const syncProject = useReferenceStudyStore((state) => state.syncProject);
  const setRun = useReferenceStudyStore((state) => state.setRun);
  const setActiveReference = useReferenceStudyStore(
    (state) => state.setActiveReference,
  );
  const requestHandoff = useReferenceStudyStore(
    (state) => state.requestHandoff,
  );
  const forgetReference = useReferenceStudyStore(
    (state) => state.forgetReference,
  );
  const runs = useReferenceStudyStore((state) => state.runs);
  const activeReferenceId = useReferenceStudyStore(
    (state) => state.activeReferenceId,
  );
  const agentStreaming = useReferenceStudyStore(
    (state) => state.agentStreaming,
  );

  useEffect(() => {
    syncProject(project.id);
  }, [project.id, syncProject]);

  const { getVideoReferenceRun } = actions;
  useReferenceRunPolling({
    referenceIds: references.map((reference) => reference.id),
    getRun: getVideoReferenceRun,
    agentStreaming,
  });

  // A run parks on its agent-owned steps once the system steps have settled.
  // Hand it to the chat then — not at click time — so the agent reads evidence
  // that actually exists. Only runs this session started are eligible: a run
  // parked from an earlier visit must not spend an agent turn on page load.
  const awaitingHandoff = useRef(new Set<string>());
  useEffect(() => {
    for (const reference of references) {
      if (!awaitingHandoff.current.has(reference.id)) continue;
      const run = runs[reference.id];
      if (!run || !systemStepsSettled(run)) continue;
      if (pendingAgentSteps(run).length === 0) {
        awaitingHandoff.current.delete(reference.id);
        continue;
      }
      awaitingHandoff.current.delete(reference.id);
      // Name the step the run is parked on and the reason it gave. A generic
      // "build the reading" ask is wrong once the reading exists and the block
      // is something else, such as thin evidence coverage.
      const blocked = blockedSteps(run)[0];
      requestHandoff({
        referenceId: reference.id,
        label: reference.label,
        ...(blocked?.note
          ? { blocked: { stepId: blocked.id, reason: blocked.note } }
          : {}),
        ...(focusText.trim() ? { focus: focusText.trim() } : {}),
      });
    }
  }, [focusText, references, requestHandoff, runs]);

  // Reports success back to the form so a failed add (e.g. a link over the
  // duration limit) leaves the value in place instead of silently clearing,
  // and surfaces the server's reason instead of swallowing it.
  const addReference = useCallback(
    async (
      input: Parameters<VideoProjectEditorActions['addVideoReference']>[0],
    ) => {
      setAddError(null);
      try {
        const project = await actions.addVideoReference(input);
        return project !== null;
      } catch (error) {
        setAddError(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [actions],
  );

  const analyze = useCallback(
    async (reference: VideoReference) => {
      setActiveReference(reference.id);
      const run = await actions.analyzeVideoReference(
        reference.id,
        focusText.trim() || undefined,
      );
      if (run) {
        awaitingHandoff.current.add(reference.id);
        setRun(run);
      }
    },
    [actions, focusText, setActiveReference, setRun],
  );

  // Cancel an in-flight run before removing the reference so the pipeline is
  // not left working on media that is about to be deleted.
  const remove = useCallback(
    async (reference: VideoReference) => {
      awaitingHandoff.current.delete(reference.id);
      if (runIsActive(runs[reference.id])) {
        await actions.cancelVideoReferenceRun(reference.id);
      }
      await actions.deleteVideoReference(reference.id);
      forgetReference(reference.id);
      setOpenedId((current) => (current === reference.id ? null : current));
    },
    [actions, forgetReference, runs],
  );

  // Clearing a parked step is the same handoff, aimed at the blocker: the chat
  // gets the reason the run gave, and the run continues itself once the agent
  // writes what it was waiting for.
  const unblock = useCallback(
    (reference: VideoReference, stepId: string, reason: string) => {
      setActiveReference(reference.id);
      requestHandoff({
        referenceId: reference.id,
        label: reference.label,
        blocked: { stepId, reason },
        ...(focusText.trim() ? { focus: focusText.trim() } : {}),
      });
    },
    [focusText, requestHandoff, setActiveReference],
  );

  const cancel = useCallback(
    async (reference: VideoReference) => {
      const run = await actions.cancelVideoReferenceRun(reference.id);
      if (run) setRun(run);
    },
    [actions, setRun],
  );

  // Hand the open reading to the chat. The turn carries this reference id, so
  // the agent answers against the analysis the user is looking at.
  const discuss = useCallback(
    (reference: VideoReference) => {
      setActiveReference(reference.id);
      requestHandoff({
        referenceId: reference.id,
        label: reference.label,
        discussResults: true,
      });
    },
    [requestHandoff, setActiveReference],
  );

  const opened = openedId
    ? (references.find((reference) => reference.id === openedId) ?? null)
    : null;

  if (opened) {
    return (
      <PanelShell title={labels.title} description={labels.description}>
        <ReferenceResultsView
          projectId={project.id}
          reference={opened}
          run={runs[opened.id] ?? null}
          onBack={() => setOpenedId(null)}
          onDiscuss={() => discuss(opened)}
        />
      </PanelShell>
    );
  }

  return (
    <PanelShell title={labels.title} description={labels.description}>
      <div className="space-y-3">
        {flagsLoading ? (
          <p className="text-muted-foreground text-xs">{labels.flagsLoading}</p>
        ) : null}
        {flagsError ? (
          <div className="space-y-2">
            <p className="text-destructive text-xs">{labels.flagsError}</p>
            <button
              type="button"
              className="border-border hover:bg-accent rounded-md border px-2 py-1 text-xs"
              onClick={onRetryFlags}
            >
              {labels.retryFlags}
            </button>
          </div>
        ) : null}
        <ReferenceAddForm
          disabled={!actionsEnabled}
          onAddFile={(file, { allowLonger }) => {
            void addReference({
              origin: 'upload',
              file,
              studyAcknowledged: true,
              allowLonger,
            });
          }}
          onAddPath={(path, { allowLonger }) =>
            addReference({
              origin: 'workspace-path',
              path,
              studyAcknowledged: true,
              allowLonger,
            })
          }
          onAddUrl={(url, { allowLonger }) =>
            addReference({
              origin: 'link',
              url,
              studyAcknowledged: true,
              allowLonger,
            })
          }
        />
        {addError ? (
          <p className="text-destructive text-xs">
            {labels.addError.replace('{error}', addError)}
          </p>
        ) : null}
        <input
          value={focusText}
          onChange={(event) => setFocusText(event.target.value)}
          placeholder={labels.focusPlaceholder}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-xs"
          disabled={!actionsEnabled}
        />
        {references.length === 0 ? (
          <p className="text-muted-foreground text-xs">{labels.empty}</p>
        ) : (
          <ul className="space-y-2">
            {references.map((reference) => (
              <ReferenceCard
                key={reference.id}
                projectId={project.id}
                reference={reference}
                run={runs[reference.id]}
                active={activeReferenceId === reference.id}
                actionsEnabled={actionsEnabled}
                onAnalyze={() => void analyze(reference)}
                onCancel={() => void cancel(reference)}
                onOpenResults={() => {
                  setActiveReference(reference.id);
                  setOpenedId(reference.id);
                }}
                onSelect={() => setActiveReference(reference.id)}
                onDelete={() => void remove(reference)}
                onSetAnalysisRange={actions.setVideoReferenceAnalysisRange}
                onUnblock={(stepId, reason) =>
                  unblock(reference, stepId, reason)
                }
              />
            ))}
          </ul>
        )}
      </div>
    </PanelShell>
  );
}
