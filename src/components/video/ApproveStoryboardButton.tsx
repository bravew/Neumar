import { useState } from 'react';

import { Check } from 'lucide-react';
import { toast } from 'sonner';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import { storyboardApprovalBlockedReason } from './storyboardApproval';

function formatSeconds(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Approve the storyboard, or explain in place why the server would refuse.
 *
 * Approval is the gate everything downstream waits on — render, generation
 * jobs, the scene projection — so a click that fails without saying anything
 * strands the whole project. The reasons are checked here rather than only on
 * the server so the button can name the number that is wrong.
 */
export function ApproveStoryboardButton({
  project,
  onApprove,
  onApproved,
  className,
}: {
  project: VideoProject;
  onApprove: () => Promise<unknown>;
  onApproved?: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.approval;
  const [busy, setBusy] = useState(false);
  const blocked = storyboardApprovalBlockedReason(project);

  const explain = (): string | null => {
    switch (blocked?.kind) {
      case 'over-duration':
        return labels.overDuration
          .replace('{duration}', formatSeconds(blocked.durationMs))
          .replace('{max}', formatSeconds(blocked.maxDurationMs))
          .replace('{template}', project.template);
      case 'over-budget':
        return labels.overBudget
          .replace('{estimate}', blocked.estimateUsd.toFixed(2))
          .replace('{cap}', blocked.capUsd.toFixed(2));
      case 'no-storyboard':
        return labels.noStoryboard;
      default:
        return null;
    }
  };

  const run = async () => {
    const reason = explain();
    if (reason) {
      // Say it where the click happened rather than firing a doomed request.
      toast.error(reason);
      return;
    }
    setBusy(true);
    try {
      await onApprove();
      onApproved?.();
    } catch (err) {
      toast.error(
        `${labels.failed}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy || blocked?.kind === 'already-approved'}
      title={explain() ?? undefined}
      onClick={() => void run()}
      className={
        className ??
        'bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60'
      }
    >
      <Check className="mr-1 inline size-3" />
      {t.video.editor.actions.approve}
    </button>
  );
}
