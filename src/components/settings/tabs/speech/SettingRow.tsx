import type { ReactNode } from 'react';

interface SettingRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

/** Renders a label+description on the left and a control on the right. */
export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-foreground text-sm font-medium">{label}</p>
        {description && (
          <p className="text-muted-foreground text-xs">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}
