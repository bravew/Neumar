import { FileVideo } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import { storyboardApprovalBlockedReason } from '../storyboardApproval';

function formatSeconds(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Why there is no file to export, and the one thing to do about it.
 *
 * Exporting depends on a chain — approve the storyboard, render it, then the
 * output exists — and every link fails silently on its own. Landing on Export
 * with an empty player and a dead Share button gives no way to find out which
 * link is open, so this names it.
 */
export function ExportBlockedNotice({ project }: { project: VideoProject }) {
  const { t } = useLanguage();
  const labels = t.video.editor.exportBlocked;
  const approval = storyboardApprovalBlockedReason(project);
  const approved = project.storyboard?.status === 'approved';

  const reason = (): string => {
    if (approval?.kind === 'over-duration') {
      return labels.overDuration
        .replace('{duration}', formatSeconds(approval.durationMs))
        .replace('{max}', formatSeconds(approval.maxDurationMs))
        .replace('{template}', project.template);
    }
    if (approval?.kind === 'over-budget') {
      return labels.overBudget
        .replace('{estimate}', approval.estimateUsd.toFixed(2))
        .replace('{cap}', approval.capUsd.toFixed(2));
    }
    if (approval?.kind === 'no-storyboard') return labels.noStoryboard;
    if (!approved) return labels.notApproved;
    return labels.notRendered;
  };

  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
      <FileVideo className="text-muted-foreground size-6" />
      <p className="text-foreground text-sm font-medium">{labels.title}</p>
      <p className="text-muted-foreground max-w-md text-xs">{reason()}</p>
      <ol className="text-muted-foreground max-w-md space-y-1 text-xs">
        <li>{labels.step1}</li>
        <li>{labels.step2}</li>
        <li>{labels.step3}</li>
      </ol>
    </div>
  );
}
