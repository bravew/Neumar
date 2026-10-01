import type { GroupedItem } from '@/components/task/groupMessages';
import type { PermissionRequestState } from '@/shared/hooks/usePermissionRequests';
import type { BranchMeta } from '@/shared/stores/branch-store';

export function injectBranchNav(
  items: GroupedItem[],
  branchState: {
    branchMeta: BranchMeta[];
    branchSelections: Record<string | number, string>;
  },
): GroupedItem[] {
  const forkPointMap = new Map<string | number, { branches: BranchMeta[] }>();
  for (const meta of branchState.branchMeta) {
    const existing = forkPointMap.get(meta.forkPointId);
    if (existing) existing.branches.push(meta);
    else forkPointMap.set(meta.forkPointId, { branches: [meta] });
  }

  const result: GroupedItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.type !== 'message' || !forkPointMap.has(item.msg.id)) continue;
    const fork = forkPointMap.get(item.msg.id);
    if (!fork) continue;
    const allBranches = [
      'main',
      ...fork.branches.map((branch) => branch.branchId),
    ];
    const selectedBranchId =
      branchState.branchSelections[item.msg.id] ?? 'main';
    result.push({
      type: 'branch-nav',
      key: `branch-nav-${item.msg.id}`,
      forkPointId: item.msg.id,
      branches: fork.branches,
      currentIndex: Math.max(0, allBranches.indexOf(selectedBranchId)),
      totalBranches: allBranches.length,
    });
  }
  return result;
}

export function appendPermissionItems(
  items: GroupedItem[],
  requests: PermissionRequestState[],
): GroupedItem[] {
  if (requests.length === 0) return items;
  return [
    ...items,
    ...requests.map((permission) => ({
      type: 'permission' as const,
      key: `permission-${permission.id}`,
      permission,
    })),
  ];
}
