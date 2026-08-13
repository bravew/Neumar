/**
 * Resize Handle — styled drag separator for react-resizable-panels v4.
 *
 * Renders a thin vertical (or horizontal) bar with a visible grip indicator
 * that appears on hover. Uses the `Separator` component from the library
 * and the `data-separator` attribute for active/hover styling.
 */

import { Separator } from 'react-resizable-panels';

import { cn } from '@/shared/lib/utils';

interface ResizeHandleProps {
  /** Panel group orientation — determines visual orientation of the grip */
  orientation?: 'horizontal' | 'vertical';
  /** Additional CSS classes */
  className?: string;
  /** ID for the separator (useful for conditional panels) */
  id?: string;
}

export function ResizeHandle({
  orientation = 'horizontal',
  className,
  id,
}: ResizeHandleProps) {
  const isHorizontal = orientation === 'horizontal';

  return (
    <Separator
      id={id}
      className={cn(
        // Base container: flex center, shrink-0 so it doesn't collapse
        'group/handle relative flex shrink-0 items-center justify-center',
        // Orientation-specific sizing and cursor
        isHorizontal ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize',
        // Active state via data-separator attribute (set by the library)
        'data-separator-active:bg-primary/5',
        className,
      )}
    >
      {/* Visible grip track */}
      <div
        className={cn(
          'rounded-full transition-colors duration-150',
          // Default: subtle, hover: more visible, active: accent color
          'bg-border/40 group-hover/handle:bg-primary/40',
          'group-data-separator-active/handle:bg-primary/60',
          isHorizontal ? 'h-8 w-0.5' : 'h-0.5 w-8',
        )}
      />
    </Separator>
  );
}
