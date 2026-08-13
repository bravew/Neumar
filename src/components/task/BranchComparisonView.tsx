import { GitMerge, X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface Message {
  id: number;
  type: string;
  content: string | null;
  branch_id?: string;
}

interface BranchComparisonViewProps {
  taskId: string;
  branchA: string;
  branchB: string;
  messages: Record<string, Message[]>;
  onMerge: (sourceBranchId: string, targetBranchId: string) => void;
  onClose: () => void;
}

function MessageRow({
  message,
  diverged,
}: {
  message: Message;
  diverged: boolean;
}) {
  const isUser = message.type === 'human' || message.type === 'user';
  return (
    <div
      className={cn(
        'rounded-md px-3 py-2 text-sm',
        diverged ? 'border border-amber-500/20 bg-amber-500/10' : 'bg-muted/40',
        isUser ? 'ml-4' : 'mr-4',
      )}
    >
      <span
        className={cn(
          'mb-1 block text-xs font-medium capitalize',
          isUser ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {message.type}
      </span>
      <p className="text-foreground line-clamp-4 break-words whitespace-pre-wrap">
        {message.content ?? '(empty)'}
      </p>
    </div>
  );
}

function computeDivergence(listA: Message[], listB: Message[]): Set<number> {
  const diverged = new Set<number>();
  const maxLen = Math.max(listA.length, listB.length);
  for (let i = 0; i < maxLen; i++) {
    const a = listA[i];
    const b = listB[i];
    if (!a || !b || a.content !== b.content || a.type !== b.type) {
      // Mark all remaining messages as diverged
      for (let j = i; j < listA.length; j++) diverged.add(listA[j].id);
      for (let j = i; j < listB.length; j++) diverged.add(listB[j].id);
      break;
    }
  }
  return diverged;
}

export function BranchComparisonView({
  branchA,
  branchB,
  messages,
  onMerge,
  onClose,
}: BranchComparisonViewProps) {
  const { t } = useLanguage();
  const msgsA = messages[branchA] ?? [];
  const msgsB = messages[branchB] ?? [];
  const divergedIds = computeDivergence(msgsA, msgsB);

  return (
    <div className="bg-background border-border flex h-full flex-col rounded-xl border shadow-lg">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-semibold">
          {t.task.branchComparisonTitle ?? 'Branch Comparison'}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onMerge(branchB, branchA)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <GitMerge className="size-3.5" />
            {t.task.branchMergeBest ?? 'Merge best'}
          </button>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors"
            aria-label={t.task.branchClose}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div className="border-border grid grid-cols-2 border-b">
        <div className="border-border border-r px-4 py-2">
          <span className="text-muted-foreground text-xs font-medium">
            {t.task.branchColumnA ?? 'Branch A'}
          </span>
          <span className="text-muted-foreground ml-1.5 font-mono text-xs opacity-60">
            {branchA.slice(0, 8)}
          </span>
        </div>
        <div className="px-4 py-2">
          <span className="text-muted-foreground text-xs font-medium">
            {t.task.branchColumnB ?? 'Branch B'}
          </span>
          <span className="text-muted-foreground ml-1.5 font-mono text-xs opacity-60">
            {branchB.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* Message columns */}
      <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
        {/* Branch A */}
        <div className="border-border space-y-2 overflow-y-auto border-r p-3">
          {msgsA.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">
              {t.task.branchNoMessages ?? 'No messages'}
            </p>
          ) : (
            msgsA.map((msg) => (
              <MessageRow
                key={msg.id}
                message={msg}
                diverged={divergedIds.has(msg.id)}
              />
            ))
          )}
        </div>

        {/* Branch B */}
        <div className="space-y-2 overflow-y-auto p-3">
          {msgsB.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">
              {t.task.branchNoMessages ?? 'No messages'}
            </p>
          ) : (
            msgsB.map((msg) => (
              <MessageRow
                key={msg.id}
                message={msg}
                diverged={divergedIds.has(msg.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Footer: divergence summary */}
      {divergedIds.size > 0 && (
        <div className="border-border border-t px-4 py-2">
          <p className="text-muted-foreground text-xs">
            <span className="font-medium text-amber-500">
              {divergedIds.size}{' '}
              {divergedIds.size !== 1
                ? (t.task.branchDivergeMsgs ?? 'messages')
                : (t.task.branchDivergeMsg ?? 'message')}
            </span>{' '}
            {t.task.branchDivergeSuffix ?? 'differ between branches'}
          </p>
        </div>
      )}
    </div>
  );
}
