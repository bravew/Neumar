/**
 * Agent Runtime Settings tab
 *
 * Lists every supported local agent runtime (installed or not), supports
 * selection persistence, in-app install/update for allowlisted methods,
 * and copy-to-terminal fallback for everything else.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAgentRuntimes } from '@/shared/hooks/useAgentRuntimes';
import type {
  OperationRecord,
  RuntimeInstallOption,
  RuntimeUpdateOption,
} from '@/shared/lib/api/agent-runtimes';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { SettingsTabProps } from '../types';
import {
  InstallConfirm,
  type PendingConfirm,
} from './agent-runtimes/InstallConfirm';
import { RuntimeCard } from './agent-runtimes/RuntimeCard';

export function AgentRuntimeSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const s = t.settings as Record<string, string>;
  const {
    loading,
    error,
    runtimes,
    rescanning,
    rescan,
    startOperation,
    operations,
    connectionTests,
    testingConnections,
    testConnection,
  } = useAgentRuntimes();

  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const selectedId = settings.defaultAgentRuntime;

  const handleSelect = useCallback(
    (agentId: string) => {
      onSettingsChange({ ...settings, defaultAgentRuntime: agentId });
    },
    [onSettingsChange, settings],
  );

  const handleCopy = useCallback(
    async (key: string, command: string) => {
      try {
        await navigator.clipboard.writeText(command);
        setCopiedKey(key);
        if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = window.setTimeout(
          () => setCopiedKey(null),
          1500,
        );
      } catch {
        toast.error(s.agentRuntimesCopyError);
      }
    },
    [s.agentRuntimesCopyError],
  );

  const handleConfirmRun = useCallback(async () => {
    if (!pending) return;
    try {
      await startOperation({
        agentId: pending.agent.id,
        intent: pending.intent,
        optionId: pending.option.id,
        confirmedCommandHash: pending.option.commandHash,
      });
      setPending(null);
      const verb =
        pending.intent === 'install'
          ? s.agentRuntimesStartingInstall
          : s.agentRuntimesStartingUpdate;
      toast.success(`${verb} ${pending.agent.name}…`);
    } catch (err) {
      toast.error(`${s.agentRuntimesStartFailed}: ${(err as Error).message}`);
    }
  }, [
    pending,
    startOperation,
    s.agentRuntimesStartingInstall,
    s.agentRuntimesStartingUpdate,
    s.agentRuntimesStartFailed,
  ]);

  const opByAgent = useMemo(() => {
    const map = new Map<string, OperationRecord>();
    for (const op of Object.values(operations)) {
      const existing = map.get(op.agentId);
      if (!existing || op.startedAt > existing.startedAt) {
        map.set(op.agentId, op);
      }
    }
    return map;
  }, [operations]);

  const triggerOption = useCallback(
    (
      agentId: string,
      intent: 'install' | 'update',
      option: RuntimeInstallOption | RuntimeUpdateOption,
    ) => {
      const runtime = runtimes.find((r) => r.id === agentId);
      if (!runtime) return;
      if (option.inAppRunnable) {
        setPending({ agent: runtime, intent, option });
      } else {
        void handleCopy(`${agentId}-${option.id}`, option.rendered);
      }
    },
    [handleCopy, runtimes],
  );

  const handleTestConnection = useCallback(
    async (agentId: string) => {
      try {
        const result = await testConnection(agentId);
        const message = result.ok
          ? s.agentRuntimesTestSucceeded
          : s.agentRuntimesTestFailed;
        if (result.ok) {
          toast.success(`${message}: ${result.message}`);
        } else {
          toast.error(`${message}: ${result.message}`);
        }
      } catch (err) {
        toast.error(`${s.agentRuntimesTestFailed}: ${(err as Error).message}`);
      }
    },
    [s.agentRuntimesTestFailed, s.agentRuntimesTestSucceeded, testConnection],
  );

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-12 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {s.agentRuntimesLoading}
      </div>
    );
  }

  const installedCount = runtimes.filter((r) => r.available).length;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{s.agentRuntimesHeading}</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {s.agentRuntimesDescription}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void rescan()}
          disabled={rescanning}
        >
          <RefreshCw
            className={cn('size-4', rescanning && 'animate-spin')}
            aria-hidden
          />
          <span className="ml-2">
            {rescanning ? s.agentRuntimesRescanning : s.agentRuntimesRescan}
          </span>
        </Button>
      </header>

      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {installedCount === 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {s.agentRuntimesNoRuntimesAvailable}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {runtimes.map((runtime) => (
          <RuntimeCard
            key={runtime.id}
            runtime={runtime}
            selected={runtime.id === selectedId}
            s={s}
            op={opByAgent.get(runtime.id)}
            onSelect={() => handleSelect(runtime.id)}
            onInstall={(option) => triggerOption(runtime.id, 'install', option)}
            onUpdate={(option) => triggerOption(runtime.id, 'update', option)}
            onCopy={(option) =>
              void handleCopy(`${runtime.id}-${option.id}`, option.rendered)
            }
            onTestConnection={() => void handleTestConnection(runtime.id)}
            testResult={connectionTests[runtime.id]}
            testing={testingConnections[runtime.id] === true}
            copiedKey={copiedKey}
          />
        ))}
      </div>

      <InstallConfirm
        pending={pending}
        s={s}
        onCancel={() => setPending(null)}
        onConfirm={() => void handleConfirmRun()}
      />
    </div>
  );
}
