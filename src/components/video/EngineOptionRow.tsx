import { AlertTriangle, Check } from 'lucide-react';

import type { VideoEngineOption } from '@/shared/video/useVideoEngines';

/** One row of the engine picker: identity, availability, honest tradeoffs. */
export function EngineOptionRow({
  engine,
  active,
  unavailableLabel,
}: {
  engine: VideoEngineOption;
  active: boolean;
  unavailableLabel: string;
}) {
  const tradeoffs = [
    ...engine.bestFor.slice(0, 2),
    ...engine.weaknesses.slice(0, 1),
  ];
  return (
    <>
      <span className="flex w-full items-center gap-1 font-medium">
        {active ? <Check className="size-3 shrink-0" /> : null}
        {engine.name}
        <span className="text-muted-foreground font-normal">
          {engine.detectedVersion ?? engine.version}
        </span>
        {!engine.installed ? (
          <span className="text-destructive ml-auto flex items-center gap-1">
            <AlertTriangle className="size-3" />
            {unavailableLabel}
          </span>
        ) : null}
      </span>
      {tradeoffs.length > 0 ? (
        <span className="text-muted-foreground text-[11px] whitespace-normal">
          {tradeoffs.join(' · ')}
        </span>
      ) : null}
    </>
  );
}
