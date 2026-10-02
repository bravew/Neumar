import { createContext, useContext, useMemo, type ReactNode } from 'react';

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
  // The thread re-renders on every streamed message; a stable value keeps
  // approval cards from re-rendering unless these inputs change.
  const value = useMemo(
    () => ({ sessionRoot, respondToPermission, sendMessage }),
    [sessionRoot, respondToPermission, sendMessage],
  );
  return (
    <TaskThreadActionsContext.Provider value={value}>
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
