/**
 * Shared Automation UI Utilities
 *
 * Common helpers used across automation components.
 */

import {
  Calendar,
  Clock,
  Hash,
  MessageSquare,
  Monitor,
  Send,
  Webhook,
  Zap,
} from 'lucide-react';

import type { AutomationTriggerType } from '@/shared/types/automation';

/** Get the Lucide icon component for a trigger type */
export function getTriggerIcon(type: AutomationTriggerType | string) {
  switch (type) {
    case 'cron':
      return Calendar;
    case 'webhook':
      return Webhook;
    case 'heartbeat':
      return Clock;
    default:
      return Zap;
  }
}

/** Format a duration in milliseconds to a human-readable string */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/** Icon map for channel/delivery platforms */
export const PLATFORM_ICONS: Record<string, typeof MessageSquare> = {
  slack: Hash,
  discord: MessageSquare,
  telegram: Send,
  lark: MessageSquare,
  desktop: Monitor,
};

/** Color styles for automation origin badges */
export const ORIGIN_STYLES: Record<string, string> = {
  channel: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  chat: 'bg-green-500/10 text-green-600 dark:text-green-400',
  api: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
};

/** Split "channelId:threadTs" conversationId into parts */
export function parseConversationId(id?: string): {
  channelId: string;
  threadTs?: string;
} | null {
  if (!id) return null;
  if (id.includes(':')) {
    const [channelId, threadTs] = id.split(':');
    return { channelId: channelId!, threadTs };
  }
  return { channelId: id };
}

/** Format an ISO timestamp to a relative time string */
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
