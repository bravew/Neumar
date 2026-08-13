import { Check, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { PublishLeg } from '@/shared/hooks/usePublishJobs';
import { useLanguage } from '@/shared/providers/language-provider';

interface ApprovalCardProps {
  leg: PublishLeg;
  onApprove: (legId: string) => void | Promise<unknown>;
  onReject: (legId: string) => void | Promise<unknown>;
}

export function ApprovalCard({ leg, onApprove, onReject }: ApprovalCardProps) {
  const { t } = useLanguage();
  const p = t.publish as Record<string, string>;
  return (
    <div className="border-border bg-background space-y-3 rounded-lg border p-4">
      <div>
        <div className="text-sm font-semibold">{p.approvalTitle}</div>
        <div className="text-muted-foreground text-sm">
          {format(p.approvalDescription, {
            destination: leg.destinationLabel ?? leg.destinationKind,
          })}
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void onApprove(leg.id)}>
          <Check className="size-4" />
          {p.approve}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void onReject(leg.id)}
        >
          <X className="size-4" />
          {p.reject}
        </Button>
      </div>
    </div>
  );
}

function format(template: string | undefined, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, value),
    template ?? '',
  );
}
