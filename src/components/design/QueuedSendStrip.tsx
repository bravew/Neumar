import { Pencil, Send, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { QueuedDesignSend } from './queued-design-sends';

interface QueuedSendStripLabels {
  queuedSendTitle: string;
  queuedSendFailed: string;
  queuedSendNow: string;
  queuedSendEdit: string;
  queuedSendRemove: string;
}

export function QueuedSendStrip({
  queuedSends,
  labels,
  onSendQueuedNow,
  onEditQueuedSend,
  onRemoveQueuedSend,
}: {
  queuedSends: QueuedDesignSend[];
  labels: QueuedSendStripLabels;
  onSendQueuedNow: (id: string) => void;
  onEditQueuedSend: (id: string) => void;
  onRemoveQueuedSend: (id: string) => void;
}) {
  if (queuedSends.length === 0) return null;

  return (
    <div
      className="border-border bg-muted/30 space-y-2 rounded-md border p-2"
      data-testid="queued-send-strip"
    >
      <div className="text-muted-foreground text-xs font-medium">
        {labels.queuedSendTitle.replace('{count}', String(queuedSends.length))}
      </div>
      <div className="space-y-1.5">
        {queuedSends.map((item) => (
          <div
            key={item.id}
            className="bg-background flex items-start gap-2 rounded border p-2"
          >
            <p className="text-foreground line-clamp-2 min-w-0 flex-1 text-xs">
              <span>{item.prompt}</span>
              {item.status === 'failed' && (
                <span className="text-destructive mt-1 line-clamp-2 block text-[11px]">
                  {item.error
                    ? `${labels.queuedSendFailed}: ${item.error}`
                    : labels.queuedSendFailed}
                </span>
              )}
            </p>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={labels.queuedSendNow}
                onClick={() => onSendQueuedNow(item.id)}
              >
                <Send className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={labels.queuedSendEdit}
                onClick={() => onEditQueuedSend(item.id)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={labels.queuedSendRemove}
                onClick={() => onRemoveQueuedSend(item.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
