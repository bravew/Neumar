import { createContext, useContext, type ReactNode } from 'react';

import type { PermissionRequestState } from '@/shared/hooks/usePermissionRequests';

interface TaskThreadActionsValue {
  sessionRoot?: string;
  respondToPermission: (
    id: string,
    decision: 'allow' | 'deny' | 'always_allow',
  ) => void;
  sendMessage: (text: string) => void;
}

const TaskThreadActionsContext = createContext<TaskThreadActionsValue | null>(
  null,
);

export function TaskThreadActions({
  sessionRoot,
  respondToPermission,
  sendMessage,
  children,
}: TaskThreadActionsValue & { children: ReactNode }) {
  return (
    <TaskThreadActionsContext.Provider
      value={{ sessionRoot, respondToPermission, sendMessage }}
    >
      {children}
    </TaskThreadActionsContext.Provider>
  );
}

export function useTaskSessionRoot(): string | undefined {
  return useContext(TaskThreadActionsContext)?.sessionRoot;
}

export function useTaskThreadActions(): TaskThreadActionsValue | null {
  return useContext(TaskThreadActionsContext);
}

export type { PermissionRequestState };
