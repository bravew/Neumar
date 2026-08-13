import type { DesignRoutineSchedule } from '@/shared/types/design-mode';

export function scheduleFromCron(
  cronExpr: string,
  timezone: string,
): DesignRoutineSchedule | null {
  const [minute, hour, dayOfMonth, , dayOfWeek] = cronExpr.trim().split(/\s+/);
  if (!minute || !hour || !dayOfMonth || dayOfWeek === undefined) return null;
  if (/^\d+$/.test(minute) && hour === '*' && dayOfMonth === '*') {
    return { kind: 'hourly', minute: Number(minute), timezone };
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === '*') {
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(
      2,
      '0',
    )}`;
    if (dayOfWeek === '*') return { kind: 'daily', time, timezone };
    if (dayOfWeek === '1-5') return { kind: 'weekdays', time, timezone };
    if (/^\d$/.test(dayOfWeek)) {
      return { kind: 'weekly', weekday: Number(dayOfWeek), time, timezone };
    }
  }
  return null;
}
