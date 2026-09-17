import { useEffect, useState } from 'react';

import { FileVideo, Link, Upload } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoProject,
  VideoReference,
  VideoReferenceRun,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { PanelShell } from '../PanelShell';
import { ReferenceReviewDialog } from './ReferenceReviewDialog';
import { ReferenceRunProgress } from './ReferenceRunProgress';

interface ReferencePanelProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  flagsLoading: boolean;
  flagsError: string | null;
  onRetryFlags: () => void;
}

export function ReferencePanel({
  project,
  actions,
  flagsLoading,
  flagsError,
  onRetryFlags,
}: ReferencePanelProps) {
  const { t } = useLanguage();
  const [pathValue, setPathValue] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [focusText, setFocusText] = useState('');
  const [selected, setSelected] = useState<VideoReference | null>(null);
  const [run, setRun] = useState<VideoReferenceRun | null>(null);
  const references = project.videoReferences ?? [];
  const actionsEnabled = !flagsLoading && !flagsError;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void actions.getVideoReferenceRun(selected.id).then((next) => {
      if (!cancelled) setRun(next);
    });
    return () => {
      cancelled = true;
    };
  }, [actions, selected]);

  return (
    <PanelShell
      title={t.video.reference.title}
      description={t.video.reference.description}
    >
      <div className="space-y-3">
        {flagsLoading ? (
          <p className="text-muted-foreground text-xs">
            {t.video.reference.flagsLoading}
          </p>
        ) : null}
        {flagsError ? (
          <div className="space-y-2">
            <p className="text-destructive text-xs">
              {t.video.reference.flagsError}
            </p>
            <button
              type="button"
              className="border-border hover:bg-accent rounded-md border px-2 py-1 text-xs"
              onClick={onRetryFlags}
            >
              {t.video.reference.retryFlags}
            </button>
          </div>
        ) : null}
        <label className="border-border hover:bg-accent/40 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm">
          <Upload className="size-4" />
          <span>{t.video.reference.addFile}</span>
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            disabled={!actionsEnabled}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                void actions.addVideoReference({
                  origin: 'upload',
                  file,
                  studyAcknowledged: true,
                });
              }
              event.currentTarget.value = '';
            }}
          />
        </label>
        <div className="flex gap-2">
          <input
            value={pathValue}
            onChange={(event) => setPathValue(event.target.value)}
            placeholder={t.video.reference.pathPlaceholder}
            className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-xs"
            disabled={!actionsEnabled}
          />
          <button
            type="button"
            className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-40"
            disabled={!actionsEnabled || !pathValue.trim()}
            onClick={() => {
              void actions.addVideoReference({
                origin: 'workspace-path',
                path: pathValue.trim(),
                studyAcknowledged: true,
              });
              setPathValue('');
            }}
          >
            <FileVideo className="size-4" />
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={urlValue}
            onChange={(event) => setUrlValue(event.target.value)}
            placeholder={t.video.reference.urlPlaceholder}
            className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-xs"
            disabled={!actionsEnabled}
          />
          <button
            type="button"
            className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-40"
            disabled={!actionsEnabled || !urlValue.trim()}
            onClick={() => {
              void actions.addVideoReference({
                origin: 'link',
                url: urlValue.trim(),
                studyAcknowledged: true,
              });
              setUrlValue('');
            }}
          >
            <Link className="size-4" />
          </button>
        </div>
        <input
          value={focusText}
          onChange={(event) => setFocusText(event.target.value)}
          placeholder={t.video.reference.focusPlaceholder}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-xs"
          disabled={!actionsEnabled}
        />
        {references.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t.video.reference.empty}
          </p>
        ) : (
          <ul className="space-y-2">
            {references.map((reference) => (
              <li
                key={reference.id}
                className="border-border space-y-2 rounded-md border p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-foreground truncate text-left text-xs font-medium"
                    onClick={() => setSelected(reference)}
                  >
                    {reference.label}
                  </button>
                  <span className="text-muted-foreground text-[10px]">
                    {(reference.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="border-border hover:bg-accent rounded border px-2 py-1 text-[11px] disabled:opacity-40"
                    disabled={!actionsEnabled}
                    onClick={async () => {
                      const next = await actions.analyzeVideoReference(
                        reference.id,
                        focusText.trim() || undefined,
                      );
                      if (next) setRun(next);
                    }}
                  >
                    {t.video.reference.analyze}
                  </button>
                  <button
                    type="button"
                    className="border-border hover:bg-accent rounded border px-2 py-1 text-[11px] disabled:opacity-40"
                    disabled={!actionsEnabled}
                    onClick={async () => {
                      const next = await actions.cancelVideoReferenceRun(
                        reference.id,
                      );
                      if (next) setRun(next);
                    }}
                  >
                    {t.video.reference.cancel}
                  </button>
                  <button
                    type="button"
                    className="border-border hover:bg-accent rounded border px-2 py-1 text-[11px] disabled:opacity-40"
                    disabled={!actionsEnabled}
                    onClick={async () => {
                      const next = await actions.resumeVideoReferenceRun(
                        reference.id,
                      );
                      if (next) setRun(next);
                    }}
                  >
                    {t.video.reference.resume}
                  </button>
                  <button
                    type="button"
                    className="border-border hover:bg-accent rounded border px-2 py-1 text-[11px]"
                    onClick={() => setSelected(reference)}
                  >
                    {t.video.reference.openResults}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {run ? <ReferenceRunProgress run={run} /> : null}
      </div>
      <ReferenceReviewDialog
        projectId={project.id}
        reference={selected}
        run={run}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </PanelShell>
  );
}
