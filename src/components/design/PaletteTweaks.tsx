import * as Popover from '@radix-ui/react-popover';
import { Palette } from 'lucide-react';

import {
  PALETTE_PRESETS,
  type PaletteBridgeRequest,
} from '@/components/artifacts/live/palette-bridge';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';

export function PaletteTweaks({
  value,
  labels,
  onChange,
}: {
  value: string;
  labels: Record<string, string>;
  onChange: (id: string, request: PaletteBridgeRequest) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Palette className="size-4" />
          {labels.paletteTweaks}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="bg-popover text-popover-foreground z-50 w-56 rounded-md border p-2 shadow-md"
        >
          <div className="grid grid-cols-2 gap-2">
            {PALETTE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange(preset.id, preset.request)}
                className={cn(
                  'hover:bg-accent flex items-center gap-2 rounded-md border p-2 text-left text-xs',
                  value === preset.id && 'border-primary bg-accent',
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-6 shrink-0 rounded border"
                  style={{ background: preset.swatch }}
                />
                <span>{labels[preset.id] ?? preset.id}</span>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
