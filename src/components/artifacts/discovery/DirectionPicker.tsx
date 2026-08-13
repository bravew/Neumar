import { useState } from 'react';

import { cn } from '@/shared/lib/utils';

export interface DirectionOption {
  id: string;
  name: string;
  description: string;
  palette: string[];
  references?: string;
}

export function DirectionPickerArtifact({
  directions,
  onPick,
}: {
  directions: DirectionOption[];
  onPick?: (direction: DirectionOption) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      {directions.map((direction) => (
        <button
          key={direction.id}
          type="button"
          className={cn(
            'rounded-md border p-3 text-left',
            picked === direction.id
              ? 'border-primary bg-primary/10'
              : 'border-border',
          )}
          onClick={() => {
            setPicked(direction.id);
            onPick?.(direction);
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{direction.name}</span>
            <span className="flex overflow-hidden rounded">
              {direction.palette.map((color) => (
                <span
                  key={color}
                  className="size-4"
                  style={{ backgroundColor: color }}
                />
              ))}
            </span>
          </div>
          <p className="text-muted-foreground mt-2 line-clamp-4 text-xs">
            {direction.description}
          </p>
          {direction.references && (
            <p className="mt-2 text-[11px] tracking-wide uppercase">
              REFS: {direction.references}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}
