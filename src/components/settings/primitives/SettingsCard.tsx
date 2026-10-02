import type { ReactNode } from 'react';

export function SettingsCard({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-card rounded-xl border">
      {title ? (
        <h3 className="text-foreground border-border border-b px-4 py-3 text-sm font-medium">
          {title}
        </h3>
      ) : null}
      <div className="divide-border divide-y">{children}</div>
    </section>
  );
}
