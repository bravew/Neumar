import type { ReactNode } from 'react';

interface PanelShellProps {
  title: string;
  description: string;
  children?: ReactNode;
}

export function PanelShell({ title, description, children }: PanelShellProps) {
  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <div>
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {description}
        </p>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
