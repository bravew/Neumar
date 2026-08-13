/**
 * CronExpressionInput
 *
 * Zapier-style frequency picker that outputs a cron expression.
 * Non-technical users pick frequency + conditional fields;
 * power users can switch to "Custom" for raw cron input.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const SELECT_CLS =
  'bg-background text-foreground border-input rounded-md border px-3 py-2 text-sm';

interface CronExpressionInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

type Frequency =
  | 'minute'
  | 'minutes'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'custom';

interface CronState {
  frequency: Frequency;
  minuteInterval: number;
  minute: number;
  hour: number;
  daysOfWeek: number[];
  dayOfMonth: number;
  customExpr: string;
}

/* ── Constants ─────────────────────────────────────────────── */

const DEFAULT_MINUTE_INTERVALS = [2, 3, 5, 10, 15, 20, 30];

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ALL_MINUTES = Array.from({ length: 60 }, (_, i) => i);
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

const pad = (n: number) => n.toString().padStart(2, '0');

/* ── Cron ↔ State helpers ──────────────────────────────────── */

function parseDaysOfWeek(dow: string): number[] {
  const days = new Set<number>();
  for (const part of dow.split(',')) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let i = +range[1]; i <= +range[2]; i++) days.add(i);
    } else if (/^\d+$/.test(part.trim())) {
      days.add(+part.trim());
    }
  }
  return Array.from(days).sort((a, b) => a - b);
}

function parseCronToState(cron: string): CronState {
  const defaults: CronState = {
    frequency: 'daily',
    minuteInterval: 5,
    minute: 0,
    hour: 9,
    daysOfWeek: [1],
    dayOfMonth: 1,
    customExpr: cron,
  };

  if (!cron.trim()) return defaults;
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return { ...defaults, frequency: 'custom' };

  const [min, hr, dom, , dow] = p;

  // * * * * *
  if (cron.trim() === '* * * * *') return { ...defaults, frequency: 'minute' };

  // */N * * * *
  const nMatch = min.match(/^\*\/(\d+)$/);
  if (nMatch && hr === '*' && dom === '*' && dow === '*')
    return {
      ...defaults,
      frequency: 'minutes',
      minuteInterval: +nMatch[1],
    };

  // M * * * * (hourly)
  if (/^\d+$/.test(min) && hr === '*' && dom === '*' && dow === '*')
    return { ...defaults, frequency: 'hourly', minute: +min };

  // M H D * * (monthly — must check before daily)
  if (/^\d+$/.test(min) && /^\d+$/.test(hr) && /^\d+$/.test(dom) && dow === '*')
    return {
      ...defaults,
      frequency: 'monthly',
      minute: +min,
      hour: +hr,
      dayOfMonth: +dom,
    };

  // M H * * DOW (weekly)
  if (/^\d+$/.test(min) && /^\d+$/.test(hr) && dom === '*' && dow !== '*') {
    const days = parseDaysOfWeek(dow);
    return {
      ...defaults,
      frequency: 'weekly',
      minute: +min,
      hour: +hr,
      daysOfWeek: days.length ? days : [1],
    };
  }

  // M H * * * (daily)
  if (/^\d+$/.test(min) && /^\d+$/.test(hr) && dom === '*' && dow === '*')
    return { ...defaults, frequency: 'daily', minute: +min, hour: +hr };

  return { ...defaults, frequency: 'custom' };
}

function buildCron(s: CronState): string {
  switch (s.frequency) {
    case 'minute':
      return '* * * * *';
    case 'minutes':
      return `*/${s.minuteInterval} * * * *`;
    case 'hourly':
      return `${s.minute} * * * *`;
    case 'daily':
      return `${s.minute} ${s.hour} * * *`;
    case 'weekly':
      return `${s.minute} ${s.hour} * * ${s.daysOfWeek.join(',')}`;
    case 'monthly':
      return `${s.minute} ${s.hour} ${s.dayOfMonth} * *`;
    case 'custom':
      return s.customExpr;
  }
}

/* ── Component ─────────────────────────────────────────────── */

export function CronExpressionInput({
  value,
  onChange,
  className,
}: CronExpressionInputProps) {
  const { t } = useLanguage();
  const cb = (t.automation as Record<string, unknown>).cronBuilder as Record<
    string,
    unknown
  >;
  const days = cb.days as Record<string, string>;

  const lastEmitted = useRef(value);
  const [state, setState] = useState<CronState>(() => parseCronToState(value));

  // Re-parse when parent changes value externally
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setState(parseCronToState(value));
      lastEmitted.current = value;
    }
  }, [value]);

  const update = useCallback(
    (patch: Partial<CronState>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        return next;
      });
      // Emit onChange outside the state updater to avoid double-firing in StrictMode
      const cron = buildCron({ ...state, ...patch });
      lastEmitted.current = cron;
      onChange(cron);
    },
    [onChange, state],
  );

  // Ensure parsed minuteInterval appears in the dropdown
  const intervalOptions = useMemo(() => {
    const base = [...DEFAULT_MINUTE_INTERVALS];
    if (!base.includes(state.minuteInterval)) base.push(state.minuteInterval);
    return base.sort((a, b) => a - b);
  }, [state.minuteInterval]);

  // Human-readable summary
  const summary = useMemo(() => {
    const time = `${pad(state.hour)}:${pad(state.minute)}`;
    switch (state.frequency) {
      case 'minute':
        return cb.summaryMinute as string;
      case 'minutes':
        return (cb.summaryMinutes as string).replace(
          '{n}',
          String(state.minuteInterval),
        );
      case 'hourly':
        return (cb.summaryHourly as string).replace('{m}', pad(state.minute));
      case 'daily':
        return (cb.summaryDaily as string).replace('{time}', time);
      case 'weekly': {
        const names = state.daysOfWeek
          .map((d) => days[WEEKDAY_KEYS[d]])
          .join(', ');
        return (cb.summaryWeekly as string)
          .replace('{days}', names)
          .replace('{time}', time);
      }
      case 'monthly':
        return (cb.summaryMonthly as string)
          .replace('{day}', String(state.dayOfMonth))
          .replace('{time}', time);
      case 'custom':
        return cb.summaryCustom as string;
    }
  }, [state, cb, days]);

  const selectCls = SELECT_CLS;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Frequency */}
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {cb.frequencyLabel as string}
        </label>
        <select
          value={state.frequency}
          onChange={(e) => update({ frequency: e.target.value as Frequency })}
          className={cn(selectCls, 'w-full')}
          aria-label={cb.frequencyLabel as string}
        >
          <option value="minute">{cb.minute as string}</option>
          <option value="minutes">{cb.minutes as string}</option>
          <option value="hourly">{cb.hourly as string}</option>
          <option value="daily">{cb.daily as string}</option>
          <option value="weekly">{cb.weekly as string}</option>
          <option value="monthly">{cb.monthly as string}</option>
          <option value="custom">{cb.custom as string}</option>
        </select>
      </div>

      {/* Every N minutes */}
      {state.frequency === 'minutes' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            {cb.every as string}
          </label>
          <div className="flex items-center gap-2">
            <select
              value={state.minuteInterval}
              onChange={(e) =>
                update({ minuteInterval: parseInt(e.target.value, 10) })
              }
              className={selectCls}
              aria-label={cb.every as string}
            >
              {intervalOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground text-sm">
              {cb.minutesUnit as string}
            </span>
          </div>
        </div>
      )}

      {/* Hourly — minute selector */}
      {state.frequency === 'hourly' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            {cb.atMinute as string}
          </label>
          <select
            value={state.minute}
            onChange={(e) => update({ minute: parseInt(e.target.value, 10) })}
            className={cn(selectCls, 'w-32')}
            aria-label={cb.atMinute as string}
          >
            {ALL_MINUTES.map((m) => (
              <option key={m} value={m}>
                :{pad(m)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Weekly — day-of-week buttons */}
      {state.frequency === 'weekly' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            {cb.onDays as string}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_KEYS.map((key, i) => {
              const on = state.daysOfWeek.includes(i);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    const next = on
                      ? state.daysOfWeek.filter((d) => d !== i)
                      : [...state.daysOfWeek, i].sort((a, b) => a - b);
                    if (next.length > 0) update({ daysOfWeek: next });
                  }}
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                    on
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {days[key]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly — day-of-month */}
      {state.frequency === 'monthly' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            {cb.onDay as string}
          </label>
          <select
            value={state.dayOfMonth}
            onChange={(e) =>
              update({ dayOfMonth: parseInt(e.target.value, 10) })
            }
            className={cn(selectCls, 'w-32')}
            aria-label={cb.onDay as string}
          >
            {DAYS_OF_MONTH.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Time picker for daily / weekly / monthly */}
      {(state.frequency === 'daily' ||
        state.frequency === 'weekly' ||
        state.frequency === 'monthly') && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            {cb.atTime as string}
          </label>
          <div className="flex items-center gap-1.5">
            <select
              value={state.hour}
              onChange={(e) => update({ hour: parseInt(e.target.value, 10) })}
              className={cn(selectCls, 'w-20')}
              aria-label={cb.ariaHour as string}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {pad(h)}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground font-medium">:</span>
            <select
              value={state.minute}
              onChange={(e) => update({ minute: parseInt(e.target.value, 10) })}
              className={cn(selectCls, 'w-20')}
              aria-label={cb.ariaMinute as string}
            >
              {ALL_MINUTES.map((m) => (
                <option key={m} value={m}>
                  {pad(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Custom cron expression */}
      {state.frequency === 'custom' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            {cb.cronExpression as string}
          </label>
          <input
            type="text"
            value={state.customExpr}
            onChange={(e) => update({ customExpr: e.target.value })}
            placeholder="0 9 * * 1-5"
            className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 font-mono text-sm placeholder:text-gray-400"
            aria-label={cb.cronExpression as string}
          />
        </div>
      )}

      {/* Summary */}
      <p className="text-muted-foreground bg-muted/50 rounded-md px-3 py-2 text-xs">
        {summary}
      </p>

      {/* Human-readable + next runs (cronstrue + cron-parser) */}
      <CronNextRuns cron={value} />
    </div>
  );
}

function CronNextRuns({ cron }: { cron: string }) {
  const { t } = useLanguage();
  const nextRuns = useMemo(() => {
    if (!cron.trim()) return [];
    try {
      const expr = CronExpressionParser.parse(cron);
      const runs: Date[] = [];
      for (let i = 0; i < 3; i++) runs.push(expr.next().toDate());
      return runs;
    } catch {
      return [];
    }
  }, [cron]);

  const humanReadable = useMemo(() => {
    if (!cron.trim()) return null;
    try {
      return cronstrue.toString(cron, {
        verbose: false,
        throwExceptionOnParseError: true,
      });
    } catch {
      return null;
    }
  }, [cron]);

  if (!humanReadable && nextRuns.length === 0) return null;

  const cb = (t.automation as Record<string, unknown>).cronBuilder as Record<
    string,
    unknown
  >;

  return (
    <div className="bg-muted/30 border-border space-y-1.5 rounded-md border px-3 py-2">
      {humanReadable && (
        <p className="text-foreground/80 text-xs font-medium">
          {humanReadable}
        </p>
      )}
      {nextRuns.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase">
            {(cb.nextRuns as string) ?? 'Next runs'}
          </p>
          {nextRuns.map((d, i) => (
            <p key={i} className="text-muted-foreground text-xs">
              {d.toLocaleString()}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
