import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  AgentRuntimeStatus,
  RuntimeInstallOption,
  RuntimeUpdateOption,
} from '@/shared/lib/api/agent-runtimes';

export interface PendingConfirm {
  agent: AgentRuntimeStatus;
  intent: 'install' | 'update';
  option: RuntimeInstallOption | RuntimeUpdateOption;
}

interface InstallConfirmProps {
  pending: PendingConfirm | null;
  s: Record<string, string>;
  onCancel: () => void;
  onConfirm: () => void;
}

export function InstallConfirm({
  pending,
  s,
  onCancel,
  onConfirm,
}: InstallConfirmProps) {
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {pending?.intent === 'update'
              ? s.agentRuntimesConfirmUpdate
              : s.agentRuntimesConfirmTitle}
          </DialogTitle>
          <DialogDescription>{s.agentRuntimesConfirmBody}</DialogDescription>
        </DialogHeader>
        {pending && (
          <div className="space-y-2">
            <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 text-xs">
              {pending.option.rendered}
            </pre>
            {pending.option.network && (
              <p className="text-xs text-amber-600">
                {s.agentRuntimesNetworkWarning}
              </p>
            )}
            {pending.option.requires && pending.option.requires.length > 0 && (
              <ul className="text-muted-foreground list-disc pl-5 text-xs">
                {pending.option.requires.map((r) => (
                  <li key={r.bin}>
                    {r.bin}
                    {r.versionRange ? ` ${r.versionRange}` : ''}
                    {r.reason ? ` — ${r.reason}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {s.agentRuntimesConfirmCancel}
          </Button>
          <Button onClick={onConfirm}>{s.agentRuntimesConfirmRun}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
