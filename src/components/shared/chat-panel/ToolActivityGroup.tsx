import { useEffect, useMemo, useRef, useState } from 'react';

import { AlertTriangle, ChevronRight } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import {
  formatArgValue,
  humanizeToolName,
  toolSummary,
  ToolOutputSummary,
} from './toolActivityFormat';
import type { ChatToolCall } from './types';

export interface ToolActivityGroupLabels {
  hide: string;
  show: string;
  failed: string;
  running: string;
  polling: string;
  checking: string;
  pending: string;
}

interface ToolActivityGroupProps {
  calls: ChatToolCall[];
  labels: ToolActivityGroupLabels;
}

type ToolRun =
  | { type: 'single'; call: ChatToolCall }
  | { type: 'polling'; name: string; calls: ChatToolCall[] };

export function ToolActivityGroup({ calls, labels }: ToolActivityGroupProps) {
  const errorCount = useMemo(
    () => calls.filter((call) => call.stage === 'error' || call.isError).length,
    [calls],
  );
  const [expanded, setExpanded] = useState(errorCount > 0);
  const userToggledRef = useRef(false);

  useEffect(() => {
    if (userToggledRef.current) return;
    if (errorCount > 0) setExpanded(true);
  }, [errorCount]);

  const runs = useMemo<ToolRun[]>(() => {
    const out: ToolRun[] = [];
    for (const call of calls) {
      const last = out[out.length - 1];
      if (last?.type === 'polling' && last.name === call.name) {
        last.calls.push(call);
      } else if (last?.type === 'single' && last.call.name === call.name) {
        out[out.length - 1] = {
          type: 'polling',
          name: call.name,
          calls: [last.call, call],
        };
      } else {
        out.push({ type: 'single', call });
      }
    }
    return out;
  }, [calls]);

  const uniqueNames = useMemo(
    () => [...new Set(calls.map((call) => humanizeToolName(call.name)))],
    [calls],
  );
  const nameSummary =
    uniqueNames.length <= 3
      ? uniqueNames.join(', ')
      : `${uniqueNames.slice(0, 3).join(', ')} +${uniqueNames.length - 3}`;

  if (calls.length === 0) return null;

  return (
    <div className="border-border/40 bg-muted/20 my-2 overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => {
          userToggledRef.current = true;
          setExpanded((value) => !value);
        }}
        className="hover:bg-muted/40 flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors"
      >
        <ChevronRight
          className={cn(
            'text-muted-foreground size-3 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <span className="text-muted-foreground">
          {expanded
            ? labels.hide
            : labels.show.replace('{count}', String(runs.length))}
        </span>
        {!expanded ? (
          <span className="text-muted-foreground/60 min-w-0 truncate">
            · {nameSummary}
          </span>
        ) : null}
        {errorCount > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
            <AlertTriangle className="size-2.5" aria-hidden />
            {labels.failed.replace('{count}', String(errorCount))}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="border-border/30 border-t px-2.5 py-1">
          {runs.map((run) =>
            run.type === 'single' ? (
              <ToolActivityLine
                key={run.call.id}
                call={run.call}
                labels={labels}
              />
            ) : (
              <PollingLine
                key={`poll-${run.calls[0].id}`}
                name={run.name}
                calls={run.calls}
                labels={labels}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function ToolActivityLine({
  call,
  labels,
}: {
  call: ChatToolCall;
  labels: ToolActivityGroupLabels;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] transition-colors"
      >
        <StageDot stage={call.stage} />
        <span className="min-w-0 truncate">{toolSummary(call)}</span>
        <ChevronRight
          className={cn(
            'text-muted-foreground/50 ml-auto size-3 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {open ? (
        <div className="text-muted-foreground mt-1 ml-4 space-y-1.5 border-l border-dashed pl-3 text-[11px]">
          {Object.keys(call.args).length > 0 ? (
            <div className="space-y-0.5">
              {Object.entries(call.args)
                .slice(0, 8)
                .map(([key, value]) => (
                  <div key={key} className="flex gap-1.5">
                    <span className="text-muted-foreground/70 shrink-0">
                      {key}:
                    </span>
                    <span className="text-foreground/80 min-w-0 break-all">
                      {formatArgValue(value)}
                    </span>
                  </div>
                ))}
            </div>
          ) : null}
          {call.result ? (
            <ToolOutputSummary content={call.result} />
          ) : call.stage === 'streaming' ||
            call.stage === 'pending' ||
            call.stage === 'executing' ? (
            <span className="text-amber-500 italic">{labels.running}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PollingLine({
  name,
  calls,
  labels,
}: {
  name: string;
  calls: ChatToolCall[];
  labels: ToolActivityGroupLabels;
}) {
  const [open, setOpen] = useState(false);
  const completed = calls.filter((call) => call.stage === 'complete').length;
  const allDone = completed === calls.length;
  const shortName = humanizeToolName(name);

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] transition-colors"
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            allDone ? 'bg-emerald-500' : 'animate-pulse bg-amber-500',
          )}
        />
        <span className="min-w-0 truncate">
          {shortName} ·{' '}
          {labels.polling.replace('{count}', String(calls.length))}
        </span>
        {!allDone ? (
          <span className="text-[10px] text-amber-500">{labels.checking}</span>
        ) : null}
        <ChevronRight
          className={cn(
            'text-muted-foreground/50 ml-auto size-3 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>

      {!allDone ? (
        <div className="bg-muted/30 relative mx-1 mt-1 h-1 overflow-hidden rounded-full">
          <div
            className="bg-primary/50 absolute h-full w-1/3 rounded-full"
            style={{
              animation: 'chatPanelToolIndeterminate 1.4s ease-in-out infinite',
            }}
          />
          <style>{`@keyframes chatPanelToolIndeterminate { 0% { left: -33%; } 100% { left: 100%; } }`}</style>
        </div>
      ) : null}

      {open ? (
        <div className="text-muted-foreground/70 mt-1 ml-4 max-h-32 space-y-px overflow-auto border-l border-dashed pl-3 text-[10px]">
          {calls.map((call, index) => (
            <div key={call.id} className="truncate">
              #{index + 1} -{' '}
              {call.result ? call.result.slice(0, 60) : labels.pending}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StageDot({ stage }: { stage: ChatToolCall['stage'] }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        stage === 'complete' && 'bg-emerald-500',
        stage === 'error' && 'bg-destructive',
        stage === 'streaming' && 'animate-pulse bg-blue-500',
        stage === 'executing' && 'animate-pulse bg-blue-500',
        stage === 'pending' && 'bg-amber-500',
        stage === 'cancelled' && 'bg-muted-foreground',
      )}
    />
  );
}
