import { getSettings, saveSettings, type Settings } from '@/shared/db/settings';

export const USAGE_ACTIVITY_DEDUPE_MS = 1000;

type UsageSettings = { ui: Settings['ui'] };

let lastRecordedAt = 0;

export function nextUsageActivityOpen(
  opens: number,
  now: number,
  recordedAt: number,
): { opens: number; lastRecordedAt: number } {
  if (now - recordedAt < USAGE_ACTIVITY_DEDUPE_MS) {
    return { opens, lastRecordedAt: recordedAt };
  }
  return { opens: opens + 1, lastRecordedAt: now };
}

export function recordUsageActivityOpen(
  now = Date.now(),
  read: () => UsageSettings = getSettings,
  write: (settings: UsageSettings) => void = (partial) => {
    saveSettings({ ...getSettings(), ui: partial.ui });
  },
): number {
  const settings = read();
  const current = settings.ui.usageActivityOpens ?? 0;
  const step = nextUsageActivityOpen(current, now, lastRecordedAt);
  lastRecordedAt = step.lastRecordedAt;
  if (step.opens === current) return current;
  write({
    ...settings,
    ui: { ...settings.ui, usageActivityOpens: step.opens },
  });
  return step.opens;
}

export function resetUsageActivityOpenClock(): void {
  lastRecordedAt = 0;
}
