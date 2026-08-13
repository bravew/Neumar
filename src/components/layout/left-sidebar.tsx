import type { Task } from '@/shared/db';

import { SidebarShell } from './sidebar-shell/SidebarShell';

interface LeftSidebarProps {
  tasks: Task[];
  currentTaskId?: string;
  onDeleteTask?: (taskId: string, deleteFolder?: boolean) => void;
  onToggleFavorite?: (taskId: string, favorite: boolean) => void;
  runningTaskIds?: string[];
}

export function LeftSidebar(props: LeftSidebarProps) {
  return <SidebarShell {...props} />;
}
