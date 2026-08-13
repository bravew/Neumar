import type { ComponentProps } from 'react';

import { formatTimelineTime } from './timelineMath';
import { TimelineToolbar } from './TimelineToolbar';

interface TimelineHeaderProps extends ComponentProps<typeof TimelineToolbar> {
  durationMs: number;
  title: string;
}

export function TimelineHeader({
  durationMs,
  title,
  ...toolbarProps
}: TimelineHeaderProps) {
  return (
    <div className="border-border flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-1.5">
      <h3 className="text-foreground flex items-baseline gap-2 text-xs font-semibold">
        <span>{title}</span>
        <span className="text-muted-foreground font-normal">
          {formatTimelineTime(durationMs)}
        </span>
      </h3>
      <TimelineToolbar {...toolbarProps} />
    </div>
  );
}
