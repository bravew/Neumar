import { useState } from 'react';

import { FileVideo, Link, Scissors, Upload } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import { CaptureRecorder } from './capture/CaptureRecorder';
import type { VideoProjectEditorActions } from './editorTypes';
import { LinkedSourcesPanel } from './LinkedSourcesPanel';
import { PanelShell } from './PanelShell';

interface SourcesPanelProps {
  project: VideoProject;
  onImportPath: (
    path: string,
    confirmed: boolean,
  ) => Promise<VideoProject | null>;
  onImportFile: (
    file: File,
    confirmed: boolean,
  ) => Promise<VideoProject | null>;
  onImportUrl: (
    url: string,
    confirmed: boolean,
  ) => Promise<{ job: { id: string; status: string } } | null>;
  onAnalyze: (sourceId: string) => Promise<VideoProject | null>;
  onCreateCutPlan: (
    sourceId: string,
    candidateIds: string[],
  ) => Promise<VideoProject | null>;
  actions?: VideoProjectEditorActions;
}

export function SourcesPanel({
  project,
  onImportPath,
  onImportFile,
  onImportUrl,
  onAnalyze,
  onCreateCutPlan,
  actions,
}: SourcesPanelProps) {
  const { t } = useLanguage();
  const [pathValue, setPathValue] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const analyses = project.sourceAnalyses ?? [];

  return (
    <PanelShell
      title={t.video.sources.title}
      description={t.video.sources.description}
    >
      <div className="space-y-3">
        <section className="space-y-3">
          <div>
            <h3 className="text-foreground text-xs font-semibold">
              {t.video.editor.sideRail.sources.footage.title}
            </h3>
          </div>
          <label className="border-border hover:bg-accent/40 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm">
            <Upload className="size-4" />
            <span>{t.video.sources.upload}</span>
            <input
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void onImportFile(file, rightsConfirmed);
                event.currentTarget.value = '';
              }}
            />
          </label>
          {actions ? (
            <CaptureRecorder project={project} actions={actions} />
          ) : null}
          <div className="flex gap-2">
            <input
              value={pathValue}
              onChange={(event) => setPathValue(event.target.value)}
              placeholder={t.video.sources.pathPlaceholder}
              className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-xs"
            />
            <button
              type="button"
              className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
              onClick={() => {
                if (pathValue.trim()) {
                  void onImportPath(pathValue.trim(), rightsConfirmed);
                  setPathValue('');
                }
              }}
            >
              <FileVideo className="size-4" />
            </button>
          </div>
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => setRightsConfirmed(event.target.checked)}
            />
            {t.video.sources.rights}
          </label>
          <div className="flex gap-2">
            <input
              value={urlValue}
              onChange={(event) => setUrlValue(event.target.value)}
              placeholder={t.video.sources.urlPlaceholder}
              className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-xs"
            />
            <button
              type="button"
              disabled={!rightsConfirmed || !urlValue.trim()}
              className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-40"
              onClick={async () => {
                const result = await onImportUrl(
                  urlValue.trim(),
                  rightsConfirmed,
                );
                if (result) {
                  setJobMessage(
                    t.video.sources.jobQueued.replace('{id}', result.job.id),
                  );
                  setUrlValue('');
                }
              }}
            >
              <Link className="size-4" />
            </button>
          </div>
          {jobMessage ? (
            <p className="text-muted-foreground text-xs">{jobMessage}</p>
          ) : null}
          <div className="space-y-2">
            {(project.sources ?? []).length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {t.video.sources.empty}
              </p>
            ) : (
              (project.sources ?? []).map((source) => {
                const analysis = analyses.find(
                  (item) => item.sourceId === source.id,
                );
                const candidates = analysis?.cutCandidates ?? [];
                return (
                  <div
                    key={source.id}
                    className="border-border rounded-md border px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <FileVideo className="text-muted-foreground size-4" />
                      <span className="text-foreground flex-1 truncate">
                        {source.origin}
                      </span>
                      <span className="text-muted-foreground">
                        {source.analysisStatus}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="border-border hover:bg-accent rounded-md border px-2 py-1"
                        onClick={() => void onAnalyze(source.id)}
                      >
                        {t.video.sources.analyze}
                      </button>
                      <button
                        type="button"
                        disabled={candidates.length === 0}
                        className="border-border hover:bg-accent rounded-md border px-2 py-1 disabled:opacity-40"
                        onClick={() =>
                          void onCreateCutPlan(
                            source.id,
                            candidates.map((candidate) => candidate.id),
                          )
                        }
                      >
                        <Scissors className="mr-1 inline size-3" />
                        {t.video.sources.acceptCuts}
                      </button>
                    </div>
                    {candidates.length ? (
                      <div className="text-muted-foreground mt-2 space-y-1">
                        {candidates.map((candidate) => (
                          <div key={candidate.id}>
                            {candidate.reason} ·{' '}
                            {Math.round(candidate.confidence * 100)}%
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </section>
        {actions ? (
          <LinkedSourcesPanel project={project} actions={actions} />
        ) : null}
      </div>
    </PanelShell>
  );
}
