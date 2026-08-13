/**
 * Branch State Store (Zustand)
 *
 * Tracks conversation branch state per task — which branch is active,
 * which branch is selected at each fork point, and branch metadata.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface BranchMeta {
  branchId: string;
  forkPointId: string | number;
  messageCount: number;
}

interface BranchState {
  activeBranchId: string;
  branchSelections: Record<string | number, string>; // forkPointMsgId → branchId
  branchMeta: BranchMeta[];
}

interface BranchStore {
  taskBranches: Record<string, BranchState>;

  /** Switch the selected branch at a specific fork point */
  selectBranchAtFork: (
    taskId: string,
    forkPointId: string | number,
    branchId: string,
  ) => void;

  /** Set the active branch for a task */
  setActiveBranch: (taskId: string, branchId: string) => void;

  /** Initialize or update branch metadata for a task */
  setBranchMeta: (taskId: string, meta: BranchMeta[]) => void;

  /** Add a single branch to the metadata */
  addBranch: (taskId: string, meta: BranchMeta) => void;

  /** Clear branch state for a task */
  clearTask: (taskId: string) => void;
}

function getOrCreateTaskState(
  taskBranches: Record<string, BranchState>,
  taskId: string,
): BranchState {
  if (!taskBranches[taskId]) {
    taskBranches[taskId] = {
      activeBranchId: 'main',
      branchSelections: {},
      branchMeta: [],
    };
  }
  return taskBranches[taskId];
}

export const useBranchStore = create<BranchStore>()(
  immer((set) => ({
    taskBranches: {},

    selectBranchAtFork: (taskId, forkPointId, branchId) =>
      set((state) => {
        const task = getOrCreateTaskState(state.taskBranches, taskId);
        task.branchSelections[forkPointId] = branchId;
      }),

    setActiveBranch: (taskId, branchId) =>
      set((state) => {
        const task = getOrCreateTaskState(state.taskBranches, taskId);
        task.activeBranchId = branchId;
      }),

    setBranchMeta: (taskId, meta) =>
      set((state) => {
        const task = getOrCreateTaskState(state.taskBranches, taskId);
        task.branchMeta = meta;
      }),

    addBranch: (taskId, meta) =>
      set((state) => {
        const task = getOrCreateTaskState(state.taskBranches, taskId);
        task.branchMeta.push(meta);
      }),

    clearTask: (taskId) =>
      set((state) => {
        delete state.taskBranches[taskId];
      }),
  })),
);
