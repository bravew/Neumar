import { useCallback, useMemo, useState } from 'react';

import { ExternalLink, RefreshCw, RotateCcw, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  usePublishJobs,
  type PublishJobSnapshot,
} from '@/shared/hooks/usePublishJobs';
import { usePublishJobStream } from '@/shared/hooks/usePublishJobStream';
import { useLanguage } from '@/shared/providers/language-provider';

import { ApprovalCard } from './ApprovalCard';
import { PerLegProgress } from './PerLegProgress';

export function PublishHistory() {
  const { t } = useLanguage();
  const p = t.publish as Record<string, string>;
  const {
    jobs,
    loading,
    error,
    reload,
    cancelJob,
    approveLeg,
    rejectLeg,
    createJob,
  } = usePublishJobs();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const streamed = usePublishJobStream(expandedId ?? undefined);
  const visibleJobs = useMemo(
    () =>
      jobs.map((snapshot) =>
        streamed.snapshot?.job.id === snapshot.job.id
          ? streamed.snapshot
          : snapshot,
      ),
    [jobs, streamed.snapshot],
  );

  const republish = useCallback(
    async (snapshot: PublishJobSnapshot) => {
      await createJob({
        workspaceId: snapshot.job.workspaceId,
        createdBy: 'human:desktop',
        source: snapshot.job.source,
        metadata: snapshot.job.metadata,
        destinations: snapshot.job.destinations,
      });
    },
    [createJob],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{p.historyTitle}</h2>
          <p className="text-muted-foreground text-sm">{p.historySubtitle}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          <RefreshCw className="size-4" />
          {p.refresh}
        </Button>
      </div>

      {error && <div className="text-destructive text-sm">{error}</div>}
      {loading && (
        <div className="text-muted-foreground text-sm">{p.loading}</div>
      )}
      {!loading && visibleJobs.length === 0 && (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {p.noJobs}
        </div>
      )}

      <div className="space-y-3">
        {visibleJobs.map((snapshot) => {
          const pendingApprovals = snapshot.legs.filter(
            (leg) =>
              leg.approvalRequired && !leg.approvedAt && leg.state === 'queued',
          );
          return (
            <div
              key={snapshot.job.id}
              className="border-border rounded-lg border p-4"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 text-left"
                onClick={() =>
                  setExpandedId((current) =>
                    current === snapshot.job.id ? null : snapshot.job.id,
                  )
                }
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {snapshot.job.metadata.title ?? snapshot.job.source.path}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {snapshot.job.state} · {snapshot.legs.length}{' '}
                    {p.destinationsCount}
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {new Date(snapshot.job.createdAt).toLocaleString()}
                </span>
              </button>

              {expandedId === snapshot.job.id && (
                <div className="mt-4 space-y-4">
                  {pendingApprovals.map((leg) => (
                    <ApprovalCard
                      key={leg.id}
                      leg={leg}
                      onApprove={approveLeg}
                      onReject={(legId) => rejectLeg(legId, p.rejectedByUser)}
                    />
                  ))}
                  {snapshot.legs.map((leg) => (
                    <div key={leg.id} className="space-y-2">
                      <PerLegProgress leg={leg} />
                      {leg.publishedRef?.url && (
                        <a
                          className="text-primary inline-flex items-center gap-1 text-xs"
                          href={leg.publishedRef.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="size-3.5" />
                          {p.openPublished}
                        </a>
                      )}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void republish(snapshot)}
                    >
                      <RotateCcw className="size-4" />
                      {p.republish}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void cancelJob(snapshot.job.id)}
                    >
                      <XCircle className="size-4" />
                      {p.cancelJob}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
