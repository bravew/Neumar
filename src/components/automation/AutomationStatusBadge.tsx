/**
 * AutomationStatusBadge
 *
 * Color-coded badge showing automation run status with icon.
 */

import type { ComponentType } from 'react';

import {
  AlertCircle,
  Ban,
  Brain,
  CheckCircle,
  Clock,
  Loader2,
  Timer,
  XCircle,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AutomationRunStatus } from '@/shared/types/automation';

interface StatusConfig {
  icon: ComponentType<{ className?: string }>;
  color: string;
}

const STATUS_CONFIG: Record<AutomationRunStatus, StatusConfig> = {
  queued: {
    icon: Clock,
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  planning: {
    icon: Brain,
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  awaiting_approval: {
    icon: AlertCircle,
    color:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  },
  executing: {
    icon: Loader2,
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  completed: {
    icon: CheckCircle,
    color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
  failed: {
    icon: XCircle,
    color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  },
  cancelled: {
    icon: Ban,
    color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  },
  timed_out: {
    icon: Timer,
    color:
      'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  },
};

interface AutomationStatusBadgeProps {
  status: AutomationRunStatus;
  className?: string;
}

export function AutomationStatusBadge({
  status,
  className,
}: AutomationStatusBadgeProps) {
  const { t } = useLanguage();
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const isAnimated = status === 'executing' || status === 'planning';
  const label = t.automation.status[status] ?? status;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.color,
        className,
      )}
      aria-label={`${t.automation.run.status}: ${label}`}
    >
      <Icon className={cn('size-3.5', isAnimated && 'animate-spin')} />
      {label}
    </span>
  );
}
