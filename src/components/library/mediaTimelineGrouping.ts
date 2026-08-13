import {
  differenceInCalendarDays,
  format,
  isSameYear,
  isToday,
  isYesterday,
} from 'date-fns';

import type { MediaGridItem } from './MediaGridView';

export interface DayGroup {
  key: string;
  label: string;
  items: MediaGridItem[];
}

export interface MonthGroup {
  bucket: string;
  label: string;
  items: MediaGridItem[];
  days: DayGroup[];
}

export function groupByMonth(
  items: MediaGridItem[],
  locale: string,
  labels: { today: string; yesterday: string },
  now: Date = new Date(),
): MonthGroup[] {
  const monthMap = new Map<string, MediaGridItem[]>();
  for (const item of items) {
    const date = parseDate(item.takenAt);
    const bucket = date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : 'unknown';
    const existing = monthMap.get(bucket);
    if (existing) existing.push(item);
    else monthMap.set(bucket, [item]);
  }

  const months: MonthGroup[] = [];
  for (const [bucket, monthItems] of monthMap) {
    monthItems.sort((a, b) => compareTakenAt(b, a));
    months.push({
      bucket,
      label: monthLabel(bucket, locale),
      items: monthItems,
      days: groupByDay(monthItems, locale, labels, now),
    });
  }
  months.sort((a, b) => (a.bucket < b.bucket ? 1 : -1));
  return months;
}

function groupByDay(
  items: MediaGridItem[],
  locale: string,
  labels: { today: string; yesterday: string },
  now: Date,
): DayGroup[] {
  const dayMap = new Map<string, MediaGridItem[]>();
  for (const item of items) {
    const date = parseDate(item.takenAt);
    const key = date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
          date.getDate(),
        ).padStart(2, '0')}`
      : 'unknown';
    const existing = dayMap.get(key);
    if (existing) existing.push(item);
    else dayMap.set(key, [item]);
  }
  const days: DayGroup[] = [];
  for (const [key, dayItems] of dayMap) {
    days.push({
      key,
      label: dayLabel(key, locale, labels, now),
      items: dayItems,
    });
  }
  days.sort((a, b) => (a.key < b.key ? 1 : -1));
  return days;
}

function parseDate(value: string | Date | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function compareTakenAt(a: MediaGridItem, b: MediaGridItem): number {
  const aDate = parseDate(a.takenAt)?.getTime() ?? 0;
  const bDate = parseDate(b.takenAt)?.getTime() ?? 0;
  return aDate - bDate;
}

function monthLabel(bucket: string, locale: string): string {
  if (bucket === 'unknown') return '—';
  const [year, month] = bucket.split('-').map(Number);
  if (!year || !month) return bucket;
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function dayLabel(
  key: string,
  locale: string,
  labels: { today: string; yesterday: string },
  now: Date,
): string {
  if (key === 'unknown') return '—';
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  const date = new Date(year, month - 1, day);
  if (isToday(date)) return labels.today;
  if (isYesterday(date)) return labels.yesterday;
  const daysAgo = differenceInCalendarDays(now, date);
  if (daysAgo > 0 && daysAgo < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  }
  if (isSameYear(date, now)) {
    return format(date, 'MMM d');
  }
  return format(date, 'MMM d, yyyy');
}
