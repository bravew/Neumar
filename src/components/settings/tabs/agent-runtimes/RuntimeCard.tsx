import {
  Check,
  Copy,
  Download,
  Loader2,
  PlugZap,
  Terminal,
  Upload,
} from 'lucide-react';

import { AgentRuntimeIcon } from '@/components/shared/AgentRuntimeIcon';
import { Button } from '@/components/ui/button';
import type {
  AgentRuntimeStatus,
  OperationRecord,
  RuntimeConnectionTestResult,
  RuntimeInstallOption,
  RuntimeUpdateOption,
} from '@/shared/lib/api/agent-runtimes';
import { cn } from '@/shared/lib/utils';

export interface RuntimeCardProps {
  runtime: AgentRuntimeStatus;
  selected: boolean;
  s: Record<string, string>;
  op?: OperationRecord;
  onSelect: () => void;
  onInstall: (option: RuntimeInstallOption) => void;
  onUpdate: (option: RuntimeUpdateOption) => void;
  onCopy: (option: RuntimeInstallOption | RuntimeUpdateOption) => void;
  onTestConnection: () => void;
  testResult?: RuntimeConnectionTestResult;
  testing: boolean;
  copiedKey: string | null;
}

export function RuntimeCard({
  runtime,
  selected,
  s,
  op,
  onSelect,
  onInstall,
  onUpdate,
  onCopy,
  onTestConnection,
  testResult,
  testing,
  copiedKey,
}: RuntimeCardProps) {
  const installOpts = runtime.install ?? [];
  const updateOpts = runtime.update ?? [];
  const isRunningOp =
    op && (op.status === 'pending' || op.status === 'running');

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 transition-colors',
        runtime.available
          ? selected
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-foreground/30'
          : 'border-muted-foreground/30 bg-muted/20 border-dashed',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AgentRuntimeIcon runtimeId={runtime.id} className="size-4" />
            <h4 className="truncate font-medium">{runtime.name}</h4>
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                runtime.available
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {runtime.available
                ? s.agentRuntimesInstalled
                : s.agentRuntimesNotInstalled}
            </span>
          </div>
          <code className="text-muted-foreground text-xs">{runtime.bin}</code>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onTestConnection}
            disabled={testing}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="size-4" aria-hidden />
            )}
            <span className="ml-1">{s.agentRuntimesTest}</span>
          </Button>
          {runtime.available && (
            <Button
              size="sm"
              variant={selected ? 'default' : 'outline'}
              onClick={onSelect}
            >
              {selected ? (
                <>
                  <Check className="size-4" />
                  <span className="ml-1">{s.agentRuntimesSelected}</span>
                </>
              ) : (
                s.agentRuntimesSelect
              )}
            </Button>
          )}
        </div>
      </div>

      {runtime.available && (
        <dl className="text-muted-foreground space-y-1 text-xs">
          {runtime.version && (
            <div className="flex gap-1">
              <dt className="font-medium">{s.agentRuntimesVersion}:</dt>
              <dd className="truncate">{runtime.version}</dd>
            </div>
          )}
          {runtime.path && (
            <div className="flex items-start gap-1">
              <dt className="font-medium">{s.agentRuntimesPath}:</dt>
              <dd className="min-w-0 break-all" title={runtime.path}>
                {runtime.path}
              </dd>
            </div>
          )}
          {runtime.auth && (
            <div className="flex gap-1">
              <dt className="font-medium">{s.agentRuntimesAuth}:</dt>
              <dd>
                {runtime.auth.state === 'authenticated' &&
                  s.agentRuntimesAuthAuthenticated}
                {runtime.auth.state === 'unauthenticated' &&
                  s.agentRuntimesAuthUnauthenticated}
                {runtime.auth.state === 'unknown' && s.agentRuntimesAuthUnknown}
                {runtime.auth.detail ? ` (${runtime.auth.detail})` : ''}
              </dd>
            </div>
          )}
        </dl>
      )}

      {isRunningOp && (
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="size-3 animate-spin" />
          {s.agentRuntimesOperationRunning}
        </div>
      )}
      {op && op.status === 'failed' && (
        <p className="text-destructive text-xs">
          {s.agentRuntimesOperationFailed}:{' '}
          {op.error || `exit ${op.exitCode ?? '?'}`}
        </p>
      )}
      {op && op.status === 'completed' && (
        <p className="text-xs text-emerald-600">
          {s.agentRuntimesOperationCompleted}
        </p>
      )}
      {op && op.status === 'cancelled' && (
        <p className="text-xs text-amber-600">
          {s.agentRuntimesOperationCancelled}
        </p>
      )}
      {testResult && (
        <p
          className={cn(
            'text-xs',
            testResult.ok ? 'text-emerald-600' : 'text-destructive',
          )}
        >
          {testResult.ok
            ? s.agentRuntimesTestSucceeded
            : s.agentRuntimesTestFailed}
          : {testResult.message}
        </p>
      )}

      {!runtime.available && installOpts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {installOpts.map((option) => {
            const copied = copiedKey === `${runtime.id}-${option.id}`;
            return (
              <Button
                key={option.id}
                size="sm"
                variant="outline"
                disabled={isRunningOp}
                onClick={() => onInstall(option)}
                title={
                  !option.inAppRunnable ? s.agentRuntimesCopyOnly : undefined
                }
              >
                {option.inAppRunnable ? (
                  <Download className="size-4" aria-hidden />
                ) : copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Terminal className="size-4" aria-hidden />
                )}
                <span className="ml-1.5">
                  {copied
                    ? s.agentRuntimesCopyCommandCopied
                    : option.inAppRunnable
                      ? s.agentRuntimesInstall
                      : s.agentRuntimesCopyCommand}
                </span>
                <span className="text-muted-foreground ml-1 text-[10px]">
                  ({option.label})
                </span>
              </Button>
            );
          })}
        </div>
      )}

      {runtime.available && updateOpts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {updateOpts.map((option) => {
            const copied = copiedKey === `${runtime.id}-${option.id}`;
            return (
              <Button
                key={option.id}
                size="sm"
                variant="outline"
                disabled={isRunningOp}
                onClick={() =>
                  option.inAppRunnable ? onUpdate(option) : onCopy(option)
                }
              >
                {option.inAppRunnable ? (
                  <Upload className="size-4" aria-hidden />
                ) : copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                <span className="ml-1.5">
                  {copied
                    ? s.agentRuntimesCopyCommandCopied
                    : option.inAppRunnable
                      ? s.agentRuntimesUpdate
                      : s.agentRuntimesCopyCommand}
                </span>
                <span className="text-muted-foreground ml-1 text-[10px]">
                  ({option.label})
                </span>
              </Button>
            );
          })}
        </div>
      )}

      {runtime.available && runtime.models.length > 0 && (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer font-medium">
            {s.agentRuntimesModels} ({runtime.models.length})
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {runtime.models.map((m) => (
              <li key={m.id} title={m.id}>
                <span className="font-medium">{m.label}</span>
                {m.label !== m.id && (
                  <code className="ml-2 text-[10px]">{m.id}</code>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {runtime.diagnostics && runtime.diagnostics.length > 0 && (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer font-medium">
            {s.agentRuntimesDiagnostics}
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {runtime.diagnostics.map((d, idx) => (
              <li
                key={`${d.level}:${idx}:${d.message}`}
                className={cn(
                  d.level === 'error' && 'text-destructive',
                  d.level === 'warn' && 'text-amber-600',
                )}
              >
                {d.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
