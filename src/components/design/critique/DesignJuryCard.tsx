import { useEffect, useState } from 'react';

import { ExternalLink, PlayCircle } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignJuryRun } from '@/shared/types/design-mode';

import { CritiqueTheaterMount } from './CritiqueTheaterMount';
import { useCritiqueRollout } from './use-critique-rollout';

export function DesignJuryCard({
  projectId,
  run,
  error,
}: {
  projectId: string;
  run: DesignJuryRun | null;
  error: string | null;
}) {
  const { t } = useLanguage();
  const [showTheater, setShowTheater] = useState(false);
  const rollout = useCritiqueRollout();

  useEffect(() => {
    setShowTheater(run?.status === 'running');
  }, [run?.id, run?.status]);

  const theaterVisible = Boolean(
    run && (showTheater || run.status === 'running'),
  );

  if (error) {
    return (
      <div className="text-destructive border-destructive/30 rounded-md border p-3 text-sm">
        {error}
      </div>
    );
  }
  if (!run) return null;
  return (
    <section
      className="rounded-md border p-3 text-sm"
      data-testid="design-jury-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{t.design.designJury}</h3>
        <span className="bg-muted rounded px-2 py-1 text-xs">
          {t.design.designJuryScore.replace(
            '{score}',
            String(run.overallScore),
          )}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 truncate text-xs">
        {run.artifactPath}
      </p>
      <ol className="mt-2 space-y-1 text-xs">
        {run.roles.map((role) => (
          <li key={role.role} className="flex justify-between gap-3">
            <span>{t.design.designJuryRoles[role.role] ?? role.role}</span>
            <span>
              {t.design.designJuryScore.replace('{score}', String(role.score))}
            </span>
          </li>
        ))}
      </ol>
      {run.mustFix.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {run.mustFix.slice(0, 3).map((item) => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground mt-2 text-xs">
        {t.design.designJuryTranscript}: {run.summaryPath}
      </p>
      {theaterVisible && (
        <div className="mt-3">
          <CritiqueTheaterMount
            projectId={projectId}
            runId={run?.id ?? null}
            enabled={theaterVisible}
            rolloutPhase={rollout.phase}
          />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {run.status !== 'running' && (
          <button
            type="button"
            onClick={() => setShowTheater(true)}
            className="border-input hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs"
          >
            <PlayCircle className="size-3.5" />
            {t.design.designJuryWatchReplay}
          </button>
        )}
        {run.artifactRef && (
          <a
            href={`${API_BASE_URL}${run.artifactRef.url}`}
            target="_blank"
            rel="noreferrer"
            className="border-input hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs"
          >
            <ExternalLink className="size-3.5" />
            {t.design.viewShippedArtifact}
          </a>
        )}
      </div>
    </section>
  );
}
