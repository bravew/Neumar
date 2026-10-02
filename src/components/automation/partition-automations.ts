export type AutomationListName = 'scheduled' | 'watching' | 'paused';

export interface PartitionableAutomation {
  id: string;
  enabled: boolean;
  trigger: { type: string };
}

export function automationListName(
  automation: PartitionableAutomation,
): AutomationListName {
  if (!automation.enabled) return 'paused';
  if (automation.trigger.type === 'cron') return 'scheduled';
  return 'watching';
}

export function partitionAutomations<T extends PartitionableAutomation>(
  automations: T[],
): Record<AutomationListName, T[]> {
  const lists: Record<AutomationListName, T[]> = {
    scheduled: [],
    watching: [],
    paused: [],
  };
  for (const automation of automations) {
    lists[automationListName(automation)].push(automation);
  }
  return lists;
}
