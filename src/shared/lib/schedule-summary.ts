import type {
  AutomationSchedule,
  AutomationTrigger,
} from '@/shared/types/automation';
import type { DesignRoutineSchedule } from '@/shared/types/design-mode';

export interface ScheduleSummaryLabels {
  manual: string;
  once: string;
  onceAt: string;
  everyMinutes: string;
  everyHours: string;
  cronExpression: string;
  hourlyAt: string;
  dailyAt: string;
  weekdaysAt: string;
  weeklyAt: string;
  heartbeatEveryMinutes: string;
  days: {
    sun: string;
    mon: string;
    tue: string;
    wed: string;
    thu: string;
    fri: string;
    sat: string;
  };
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

export function formatAutomationTriggerSummary(
  trigger: AutomationTrigger,
  labels: ScheduleSummaryLabels,
): string | null {
  if (trigger.type === 'cron') {
    return formatAutomationScheduleSummary(trigger.schedule, labels);
  }
  if (trigger.type === 'heartbeat') {
    const minutes = Math.max(
      1,
      Math.round(trigger.heartbeat.intervalMs / MS_PER_MINUTE),
    );
    return labels.heartbeatEveryMinutes.replace('{minutes}', String(minutes));
  }
  if (trigger.type === 'manual') return labels.manual;
  return null;
}

export function formatAutomationScheduleSummary(
  schedule: AutomationSchedule,
  labels: ScheduleSummaryLabels,
): string {
  if (schedule.kind === 'once') {
    return schedule.at
      ? labels.onceAt.replace('{time}', formatDateTime(schedule.at))
      : labels.once;
  }
  if (schedule.kind === 'interval') {
    const minutes = Math.max(
      1,
      Math.round((schedule.intervalMs ?? MS_PER_MINUTE) / MS_PER_MINUTE),
    );
    if (minutes >= MINUTES_PER_HOUR && minutes % MINUTES_PER_HOUR === 0) {
      return labels.everyHours.replace(
        '{hours}',
        String(minutes / MINUTES_PER_HOUR),
      );
    }
    return labels.everyMinutes.replace('{minutes}', String(minutes));
  }
  return formatCronSummary(schedule.cronExpr ?? '', labels);
}

export function formatDesignRoutineScheduleSummary(
  schedule: DesignRoutineSchedule,
  labels: ScheduleSummaryLabels,
): string {
  switch (schedule.kind) {
    case 'manual':
      return labels.manual;
    case 'hourly':
      return labels.hourlyAt.replace(
        '{minute}',
        String(schedule.minute).padStart(2, '0'),
      );
    case 'daily':
      return labels.dailyAt.replace('{time}', schedule.time);
    case 'weekdays':
      return labels.weekdaysAt.replace('{time}', schedule.time);
    case 'weekly':
      return labels.weeklyAt
        .replace('{day}', weekdayLabel(schedule.weekday, labels))
        .replace('{time}', schedule.time);
  }
}

function formatCronSummary(
  cronExpr: string,
  labels: ScheduleSummaryLabels,
): string {
  const trimmed = cronExpr.trim();
  const [minute, hour, dayOfMonth, , dayOfWeek] = trimmed.split(/\s+/);
  if (minute === '*' && hour === '*' && dayOfMonth === '*') {
    return labels.everyMinutes.replace('{minutes}', '1');
  }
  const stepMinute = minute.match(/^\*\/(\d+)$/);
  if (stepMinute && hour === '*' && dayOfMonth === '*') {
    return labels.everyMinutes.replace('{minutes}', stepMinute[1]);
  }
  const stepHour = hour?.match(/^\*\/(\d+)$/);
  if (/^\d+$/.test(minute) && stepHour && dayOfMonth === '*') {
    return labels.everyHours.replace('{hours}', stepHour[1]);
  }
  if (/^\d+$/.test(minute) && hour === '*' && dayOfMonth === '*') {
    return labels.hourlyAt.replace(
      '{minute}',
      String(Number(minute)).padStart(2, '0'),
    );
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === '*') {
    const time = `${String(Number(hour)).padStart(2, '0')}:${String(
      Number(minute),
    ).padStart(2, '0')}`;
    if (dayOfWeek === '*') return labels.dailyAt.replace('{time}', time);
    if (dayOfWeek === '1-5') {
      return labels.weekdaysAt.replace('{time}', time);
    }
    if (/^\d$/.test(dayOfWeek ?? '')) {
      return labels.weeklyAt
        .replace('{day}', weekdayLabel(Number(dayOfWeek), labels))
        .replace('{time}', time);
    }
  }
  return labels.cronExpression.replace('{expr}', trimmed || '* * * * *');
}

function weekdayLabel(weekday: number, labels: ScheduleSummaryLabels): string {
  const days = [
    labels.days.sun,
    labels.days.mon,
    labels.days.tue,
    labels.days.wed,
    labels.days.thu,
    labels.days.fri,
    labels.days.sat,
  ];
  return days[((weekday % days.length) + days.length) % days.length];
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
