import type { ReactNode } from 'react';

interface SectionHeaderProps {
  icon: ReactNode;
  title: string;
}

export function SectionHeader({ icon, title }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-foreground text-base font-medium">{title}</h3>
    </div>
  );
}
