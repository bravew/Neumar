import { Check, ShieldCheck } from 'lucide-react';

import {
  publishDestinationOptionId,
  type PublishDestinationOption,
} from '@/shared/hooks/usePublishJobs';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface DestinationPickerProps {
  destinations: PublishDestinationOption[];
  selectedDestinationIds: string[];
  onToggle: (destinationId: string) => void;
}

export function DestinationPicker({
  destinations,
  selectedDestinationIds,
  onToggle,
}: DestinationPickerProps) {
  const { t } = useLanguage();
  const p = t.publish as Record<string, string>;
  if (destinations.length === 0) {
    return (
      <div className="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
        {p.noDestinations}
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {destinations.map((destination) => {
        const destinationId = publishDestinationOptionId(destination);
        const selected = selectedDestinationIds.includes(destinationId);
        return (
          <button
            key={destinationId}
            type="button"
            onClick={() => onToggle(destinationId)}
            className={cn(
              'border-border hover:bg-accent flex min-h-20 items-start gap-3 rounded-lg border p-3 text-left transition-colors',
              selected && 'border-primary bg-primary/5',
            )}
            aria-pressed={selected}
          >
            <span
              className={cn(
                'mt-0.5 flex size-5 items-center justify-center rounded border',
                selected
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'border-border',
              )}
            >
              {selected && <Check className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {destination.label ?? labelFor(destination.kind, p)}
              </span>
              <span className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                <ShieldCheck className="size-3.5" />
                {destination.capabilities.approvalDefault
                  ? p.approvalDefault
                  : p.approvalOptional}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function labelFor(kind: string, p: Record<string, string>): string {
  return p[`destination_${kind.replace(/-/g, '_')}`] ?? kind;
}
