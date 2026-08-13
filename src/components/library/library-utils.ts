/**
 * Library page utilities — formatters, status configuration, and shared types.
 */

import {
  ArrowDownAZ,
  ArrowUpZA,
  Calendar,
  Circle,
  CircleCheck,
  CircleX,
  Clock,
  Loader2,
  StopCircle,
} from 'lucide-react';

import type { TaskStatus } from '@/shared/db';

// ============================================================================
// Types
// ============================================================================

export type SortOption =
  | 'newest'
  | 'oldest'
  | 'name-az'
  | 'name-za'
  | 'recently-updated';

export type FilterOption =
  | 'all'
  | 'running'
  | 'completed'
  | 'error'
  | 'favorites';

export interface StatusConfig {
  icon: typeof Circle;
  color: string;
  bg: string;
  animate: boolean;
}

// ============================================================================
// Status Configuration
// ============================================================================

export function getStatusConfig(status: TaskStatus | undefined): StatusConfig {
  switch (status) {
    case 'running':
      return {
        icon: Loader2,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
        animate: true,
      };
    case 'completed':
      return {
        icon: CircleCheck,
        color: 'text-emerald-500',
        bg: 'bg-emerald-500/10',
        animate: false,
      };
    case 'error':
      return {
        icon: CircleX,
        color: 'text-red-500',
        bg: 'bg-red-500/10',
        animate: false,
      };
    case 'stopped':
      return {
        icon: StopCircle,
        color: 'text-amber-500',
        bg: 'bg-amber-500/10',
        animate: false,
      };
    default:
      return {
        icon: Circle,
        color: 'text-muted-foreground',
        bg: 'bg-muted/50',
        animate: false,
      };
  }
}

// ============================================================================
// Sort Icon Helper
// ============================================================================

export function getSortIcon(sortOption: SortOption) {
  switch (sortOption) {
    case 'newest':
    case 'oldest':
      return Clock;
    case 'name-az':
      return ArrowDownAZ;
    case 'name-za':
      return ArrowUpZA;
    case 'recently-updated':
      return Calendar;
  }
}

// ============================================================================
// Formatters
// ============================================================================

/** Format relative time with i18n support. */
export function formatRelativeTime(
  dateStr: string,
  t: {
    justNow: string;
    minuteAgo: string;
    minutesAgo: string;
    hourAgo: string;
    hoursAgo: string;
    dayAgo: string;
    daysAgo: string;
  },
): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return t.justNow;
  } else if (diffMinutes < 60) {
    return (diffMinutes === 1 ? t.minuteAgo : t.minutesAgo).replace(
      '{count}',
      String(diffMinutes),
    );
  } else if (diffHours < 24) {
    return (diffHours === 1 ? t.hourAgo : t.hoursAgo).replace(
      '{count}',
      String(diffHours),
    );
  } else if (diffDays === 1) {
    return t.dayAgo;
  } else {
    return t.daysAgo.replace('{count}', String(diffDays));
  }
}

/** Format absolute date for display (e.g. "Feb 15, 2026 3:42 PM"). */
export function formatAbsoluteDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format a cost given in cents (e.g. from trace/task data) to a display string. */
export function formatCostCents(cents: number): string {
  if (cents < 1) return `$${(cents / 100).toFixed(4)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format cost (USD) to display string. Returns "$0" for subscription (cost=0). */
export function formatCost(usd: number | null): string | null {
  if (usd == null) return null;
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** Format duration from milliseconds to human-readable string. */
export function formatDuration(ms: number | null): string | null {
  if (ms == null || ms <= 0) return null;
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** Extract basename from a file path (cross-platform). */
export function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}
