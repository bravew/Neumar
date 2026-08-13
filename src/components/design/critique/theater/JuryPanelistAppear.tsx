import type { ReactNode } from 'react';

export function JuryPanelistAppear({ children }: { children: ReactNode }) {
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1">
      {children}
    </div>
  );
}
