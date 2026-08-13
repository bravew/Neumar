/**
 * AutomationNotification
 *
 * Toast notification component for automation run completions
 * and lifecycle events (expiry, budget exhaustion, etc.).
 *
 * Features:
 * - Click notification body to open HeartbeatDetailDialog (modal)
 * - Stop button to disable the heartbeat/automation directly from the toast
 * - Auto-dismiss after 15 seconds
 *
 * Connects to the SSE event stream via useAutomationEvents hook.
 * Mounted at the app layout level (main.tsx) so notifications appear on all pages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Square, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/config';
import {
  useAutomationEvents,
  type AutomationEvent,
} from '@/shared/hooks/useAutomationEvents';
import {
  notifyAgentEvent,
  type AgentNotificationKind,
} from '@/shared/lib/notifications';
import { useLanguage } from '@/shared/providers/language-provider';

import { HeartbeatDetailDialog } from './HeartbeatDetailDialog';

interface AutomationNotificationData {
  id: string;
  automationId: string;
  name: string;
  status: 'completed' | 'failed' | 'expired' | 'budget' | 'disabled';
  message?: string;
  timestamp: number;
}

const NOTIFICATION_TTL_MS = 15_000;

/** Strip markdown syntax for plain-text toast preview */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1') // italic
    .replace(/`(.+?)`/g, '$1') // inline code
    .replace(/^\s*[-*+]\s+/gm, '• ') // list items
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .trim();
}

function mapEventToNotification(
  event: AutomationEvent,
): AutomationNotificationData | null {
  const data = event.data;
  if (!data || !event.automationId) return null;

  const id = event.runId ?? event.automationId ?? event.timestamp;

  switch (event.event) {
    case 'run:completed':
      return {
        id,
        automationId: event.automationId,
        name: data.name ?? 'Automation',
        status: 'completed',
        message: data.result?.slice(0, 200),
        timestamp: Date.now(),
      };
    case 'run:failed':
      return {
        id,
        automationId: event.automationId,
        name: data.name ?? 'Automation',
        status: 'failed',
        message: data.error?.slice(0, 200),
        timestamp: Date.now(),
      };
    case 'automation:expired':
      return {
        id,
        automationId: event.automationId,
        name: data.name ?? 'Automation',
        status: 'expired',
        message: data.message,
        timestamp: Date.now(),
      };
    case 'automation:budget_exhausted':
    case 'automation:max_runs_reached':
      return {
        id,
        automationId: event.automationId,
        name: data.name ?? 'Automation',
        status: 'budget',
        message: data.message ?? data.reason,
        timestamp: Date.now(),
      };
    case 'automation:consecutive_failures':
      return {
        id,
        automationId: event.automationId,
        name: data.name ?? 'Automation',
        status: 'disabled',
        message: data.message ?? data.reason,
        timestamp: Date.now(),
      };
    default:
      return null;
  }
}

function getStatusTitle(
  status: AutomationNotificationData['status'],
  name: string,
  strings: {
    runCompleted: string;
    runFailed: string;
    expired: string;
    budgetReached: string;
    disabled?: string;
  },
): string {
  switch (status) {
    case 'completed':
      return strings.runCompleted.replace('{name}', name);
    case 'failed':
      return strings.runFailed.replace('{name}', name);
    case 'expired':
      return strings.expired.replace('{name}', name);
    case 'budget':
      return strings.budgetReached;
    case 'disabled':
      return (
        strings.disabled?.replace('{name}', name) ??
        `${name} — disabled due to repeated failures`
      );
  }
}

export function AutomationNotification() {
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState<
    AutomationNotificationData[]
  >([]);
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const notifStrings = useMemo(
    () =>
      t.automation.notifications ?? {
        runCompleted: '{name} — completed',
        runFailed: '{name} — failed',
        expired: '{name} has expired',
        budgetReached: 'Automation budget reached',
        disabled: '{name} — disabled due to repeated failures',
        dismiss: 'Dismiss',
      },
    [t.automation.notifications],
  );

  // Connect to SSE event stream — skip channel-origin automations
  // (they deliver to Slack/Discord/etc. directly, no desktop toast needed)
  const handleEvent = useCallback(
    (event: AutomationEvent) => {
      if (event.data?.origin === 'channel') return;
      const notification = mapEventToNotification(event);
      if (notification) {
        const kind: AgentNotificationKind =
          notification.status === 'completed'
            ? 'succeeded'
            : notification.status === 'failed'
              ? 'failed'
              : 'error';
        const title = getStatusTitle(
          notification.status,
          notification.name,
          notifStrings,
        );
        void notifyAgentEvent(
          {
            runId: `automation:${notification.id}:${notification.status}`,
            kind,
            title,
            body: notification.message
              ? stripMarkdown(notification.message)
              : undefined,
            link: '/automation',
            source: 'automation-sse',
            timestamp: notification.timestamp,
          },
          { showToast: false },
        ).then((accepted) => {
          if (!accepted) return;
          setNotifications((prev) => [notification, ...prev].slice(0, 5));
        });
      }
    },
    [notifStrings],
  );

  useAutomationEvents(handleEvent);

  // Auto-dismiss after TTL — only tick when notifications exist
  const hasNotifications = notifications.length > 0;
  useEffect(() => {
    if (!hasNotifications) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setNotifications((prev) =>
        prev.filter((n) => now - n.timestamp < NOTIFICATION_TTL_MS),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [hasNotifications]);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Stop (disable) the automation directly from the notification
  const stopAutomation = useCallback(
    async (automationId: string, notificationId: string) => {
      setStopping((prev) => new Set(prev).add(automationId));
      try {
        await fetch(`${API_BASE_URL}/automation/${automationId}/toggle`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        });
        setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      } catch {
        // Silently fail — user can stop from the detail dialog
      } finally {
        setStopping((prev) => {
          const next = new Set(prev);
          next.delete(automationId);
          return next;
        });
      }
    },
    [],
  );

  return (
    <>
      {/* Detail dialog — opened when clicking a notification */}
      <HeartbeatDetailDialog
        automationId={detailId}
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      />

      {/* Toast notifications */}
      {notifications.length > 0 && (
        <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className="bg-card animate-in slide-in-from-right fade-in hover:bg-muted/50 max-w-sm cursor-pointer rounded-lg border p-3 shadow-lg transition-colors"
              onClick={() => setDetailId(notification.automationId)}
              role="button"
              tabIndex={0}
              aria-label={getStatusTitle(
                notification.status,
                notification.name,
                notifStrings,
              )}
              onKeyDown={(e) =>
                e.key === 'Enter' && setDetailId(notification.automationId)
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-medium">
                    {getStatusTitle(
                      notification.status,
                      notification.name,
                      notifStrings,
                    )}
                  </p>
                  {notification.message && (
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                      {stripMarkdown(notification.message)}
                    </p>
                  )}
                </div>
                <div
                  className="flex shrink-0 items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Stop button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive size-6 p-0"
                    onClick={() =>
                      stopAutomation(notification.automationId, notification.id)
                    }
                    disabled={stopping.has(notification.automationId)}
                    title={t.automation.disable ?? 'Stop'}
                    aria-label={t.automation.disable ?? 'Stop'}
                  >
                    <Square className="size-3" />
                  </Button>
                  {/* Dismiss button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground size-6 p-0"
                    onClick={() => dismiss(notification.id)}
                    title={notifStrings.dismiss ?? 'Dismiss'}
                    aria-label={notifStrings.dismiss ?? 'Dismiss'}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
