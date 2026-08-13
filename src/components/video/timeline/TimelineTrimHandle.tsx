import type { PointerEvent } from 'react';

import { cn } from '@/shared/lib/utils';

interface TimelineTrimHandleProps {
  side: 'left' | 'right';
  label: string;
  disabled: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
}

export function TimelineTrimHandle({
  side,
  label,
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: TimelineTrimHandleProps) {
  return (
    <button
      type="button"
      className={cn(
        'absolute top-0 bottom-0 z-10 w-2 cursor-ew-resize bg-black/0 hover:bg-white/45 focus:bg-white/45',
        side === 'left' ? 'left-0' : 'right-0',
        disabled && 'cursor-not-allowed hover:bg-black/0 focus:bg-black/0',
      )}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}
