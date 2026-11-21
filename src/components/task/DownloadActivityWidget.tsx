import type { DownloadActivity } from '@neumar/video-ir';
import { Download } from 'lucide-react';

import { DownloadItemRow } from '@/components/task/DownloadItemRow';
import { useLanguage } from '@/shared/providers/language-provider';

/**
 * One card per download batch, rendered from the persisted activity so a live
 * run and a reloaded task show the same thing. Each video keeps its own
 * outcome: a failed sibling never hides a saved file.
 */
export function DownloadActivityWidget({
  activity,
}: {
  activity: DownloadActivity;
}) {
  const { t } = useLanguage();
  const saved = activity.items.filter((item) => item.phase === 'saved').length;
  return (
    <div className="mx-auto max-w-4xl px-4 py-2">
      <section
        aria-label={t.mediaDownload.title}
        className="border-border/60 bg-muted/20 rounded-lg border p-3 text-sm"
      >
        <div className="mb-1 flex items-center gap-2">
          <Download className="text-primary size-4 shrink-0" aria-hidden />
          <span className="text-foreground font-medium">
            {t.mediaDownload.title}
          </span>
          <span
            role="status"
            className="text-muted-foreground ml-auto shrink-0 text-xs"
          >
            {t.mediaDownload.summary
              .replace('{saved}', String(saved))
              .replace('{total}', String(activity.items.length))}
          </span>
        </div>
        <ul className="divide-border/40 divide-y">
          {activity.items.map((item, index) => (
            <DownloadItemRow
              key={item.itemId}
              taskId={activity.taskId}
              item={item}
              index={index}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
