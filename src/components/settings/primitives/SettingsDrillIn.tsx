import type { ReactNode } from 'react';

import { ChevronLeft } from 'lucide-react';

export function SettingsDrillIn({
  title,
  onBack,
  backLabel,
  children,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 translate-x-0 flex-col motion-safe:animate-[settings-drill-in_var(--motion-base)_var(--ease-out)]">
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" />
          {backLabel}
        </button>
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
