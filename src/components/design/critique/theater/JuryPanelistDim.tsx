import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

export function JuryPanelistDim({
  dimmed,
  children,
}: {
  dimmed: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'transition-opacity motion-reduce:transition-none',
        dimmed && 'opacity-70',
      )}
    >
      {children}
    </div>
  );
}
