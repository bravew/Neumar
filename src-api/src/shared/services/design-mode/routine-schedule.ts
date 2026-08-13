import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';

import type { AutomationSchedule } from '@/shared/automation/types';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const designRoutineScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }),
  z.object({
    kind: z.literal('hourly'),
    minute: z.number().int().min(0).max(59),
    timezone: z.string().min(1).default('UTC'),
  }),
  z.object({
    kind: z.literal('daily'),
    time: z.string().regex(TIME_RE),
    timezone: z.string().min(1),
  }),
  z.object({
    kind: z.literal('weekdays'),
    time: z.string().regex(TIME_RE),
    timezone: z.string().min(1),
  }),
  z.object({
    kind: z.literal('weekly'),
    weekday: z.number().int().min(0).max(6),
    time: z.string().regex(TIME_RE),
    timezone: z.string().min(1),
  }),
]);

export type DesignRoutineSchedule = z.infer<typeof designRoutineScheduleSchema>;

export interface RoutineNextRun {
  nextRunAt: string | null;
  cronExpr: string | null;
  timezone: string | null;
  dstSkipped: boolean;
  nominalLocalTime: string | null;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

export function routineScheduleToAutomationSchedule(
  schedule: DesignRoutineSchedule,
): AutomationSchedule | null {
  const cronExpr = cronExpressionForRoutineSchedule(schedule);
  if (!cronExpr) return null;
  return {
    kind: 'cron',
    cronExpr,
    timezone: timezoneForRoutineSchedule(schedule) ?? undefined,
  };
}

export function cronExpressionForRoutineSchedule(
  schedule: DesignRoutineSchedule,
): string | null {
  switch (schedule.kind) {
    case 'manual':
      return null;
    case 'hourly':
      return `${schedule.minute} * * * *`;
    case 'daily': {
      const { hour, minute } = parseTime(schedule.time);
      return `${minute} ${hour} * * *`;
    }
    case 'weekdays': {
      const { hour, minute } = parseTime(schedule.time);
      return `${minute} ${hour} * * 1-5`;
    }
    case 'weekly': {
      const { hour, minute } = parseTime(schedule.time);
      return `${minute} ${hour} * * ${schedule.weekday}`;
    }
  }
}

export function computeNextRoutineRun(
  schedule: DesignRoutineSchedule | null | undefined,
  options: { after?: Date; lastFiredUtc?: string | null } = {},
): RoutineNextRun {
  if (!schedule || schedule.kind === 'manual') {
    return {
      nextRunAt: null,
      cronExpr: null,
      timezone: null,
      dstSkipped: false,
      nominalLocalTime: null,
    };
  }

  const timezone = timezoneForRoutineSchedule(schedule) ?? 'UTC';
  assertValidTimezone(timezone);
  const cronExpr = cronExpressionForRoutineSchedule(schedule);
  if (!cronExpr) {
    return {
      nextRunAt: null,
      cronExpr: null,
      timezone,
      dstSkipped: false,
      nominalLocalTime: null,
    };
  }

  const after = options.after ?? new Date();
  const expr = CronExpressionParser.parse(cronExpr, {
    currentDate: after,
    tz: timezone,
  });
  let next = expr.next().toDate();
  let dstSkipped = false;

  const wallClock = wallClockForRoutineSchedule(schedule);
  if (wallClock) {
    const local = getZonedParts(next, timezone);
    if (local.hour !== wallClock.hour || local.minute !== wallClock.minute) {
      const recovered = findFirstValidZonedMinute(
        {
          year: local.year,
          month: local.month,
          day: local.day,
          hour: wallClock.hour,
          minute: wallClock.minute,
        },
        timezone,
      );
      if (recovered && recovered > after) {
        next = recovered;
        dstSkipped = true;
      }
    }
  }

  if (options.lastFiredUtc && next <= new Date(options.lastFiredUtc)) {
    const refireExpr = CronExpressionParser.parse(cronExpr, {
      currentDate: new Date(new Date(options.lastFiredUtc).getTime() + 60_000),
      tz: timezone,
    });
    next = refireExpr.next().toDate();
  }

  return {
    nextRunAt: next.toISOString(),
    cronExpr,
    timezone,
    dstSkipped,
    nominalLocalTime: formatNominalLocalTime(next, timezone),
  };
}

function timezoneForRoutineSchedule(
  schedule: DesignRoutineSchedule,
): string | null {
  return schedule.kind === 'manual' ? null : schedule.timezone;
}

function wallClockForRoutineSchedule(
  schedule: DesignRoutineSchedule,
): { hour: number; minute: number } | null {
  if (schedule.kind === 'daily' || schedule.kind === 'weekdays') {
    return parseTime(schedule.time);
  }
  if (schedule.kind === 'weekly') {
    return parseTime(schedule.time);
  }
  return null;
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = TIME_RE.exec(time);
  if (!match) throw new Error(`Invalid routine schedule time: ${time}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}

function formatterForTimezone(timezone: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  FORMATTER_CACHE.set(timezone, formatter);
  return formatter;
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = formatterForTimezone(timezone).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.get('year')),
    month: Number(byType.get('month')),
    day: Number(byType.get('day')),
    hour: Number(byType.get('hour')),
    minute: Number(byType.get('minute')),
  };
}

function findFirstValidZonedMinute(
  local: ZonedParts,
  timezone: string,
): Date | null {
  const startMinute = local.hour * 60 + local.minute;
  for (let offset = 0; offset <= 180; offset += 1) {
    const total = startMinute + offset;
    const candidate = addLocalMinutes(local, total);
    const utc = zonedLocalMinuteToUtc(candidate, timezone);
    if (utc) return utc;
  }
  return null;
}

function addLocalMinutes(base: ZonedParts, totalMinutes: number): ZonedParts {
  const utc = new Date(Date.UTC(base.year, base.month - 1, base.day, 0, 0));
  utc.setUTCMinutes(totalMinutes);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hour: utc.getUTCHours(),
    minute: utc.getUTCMinutes(),
  };
}

function zonedLocalMinuteToUtc(
  local: ZonedParts,
  timezone: string,
): Date | null {
  const roughUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
  const start = roughUtc - 14 * 60 * 60 * 1000;
  const end = roughUtc + 14 * 60 * 60 * 1000;
  for (let time = start; time <= end; time += 60_000) {
    const date = new Date(time);
    const parts = getZonedParts(date, timezone);
    if (
      parts.year === local.year &&
      parts.month === local.month &&
      parts.day === local.day &&
      parts.hour === local.hour &&
      parts.minute === local.minute
    ) {
      return date;
    }
  }
  return null;
}

function formatNominalLocalTime(date: Date, timezone: string): string {
  const parts = getZonedParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day,
  ).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(
    parts.minute,
  ).padStart(2, '0')} ${timezone}`;
}
