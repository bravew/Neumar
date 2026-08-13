import type { ReactNode } from 'react';

interface SidebarSlotProps {
  children?: ReactNode;
}

export function SidebarTop({ children }: SidebarSlotProps) {
  return <div data-sidebar-slot="top">{children}</div>;
}

export function SidebarSections({ children }: SidebarSlotProps) {
  return <div data-sidebar-slot="sections">{children}</div>;
}

export function SidebarRecents({ children }: SidebarSlotProps) {
  return <div data-sidebar-slot="recents">{children}</div>;
}

export function SidebarFooter({ children }: SidebarSlotProps) {
  return <div data-sidebar-slot="footer">{children}</div>;
}
