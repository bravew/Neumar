/**
 * Slack Gateway Settings
 *
 * Controls for the Slack Socket Mode gateway: start, stop, restart, test.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

interface GatewayStatus {
  state: 'stopped' | 'starting' | 'running' | 'error';
  connectedAt: string | null;
  lastMessageAt: string | null;
  error: string | null;
  stats: {
    messagesReceived: number;
    messagesProcessed: number;
    errors: number;
  };
}

const STATE_LABEL_KEYS = {
  running: 'slackGatewayStateRunning',
  stopped: 'slackGatewayStateStopped',
  starting: 'slackGatewayStateStarting',
  error: 'slackGatewayStateError',
} as const;

export function SlackGatewaySettings() {
  const { t } = useLanguage();
  const s = t.settings;
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message?: string;
  } | null>(null);

  const fetchStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE_URL}/slack/gateway/status`, {
        signal,
      });
      const data = await res.json();
      if (data.success && data.data) {
        setStatus(data.data);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchStatus(controller.signal);
    return () => controller.abort();
  }, [fetchStatus]);

  const actionControllerRef = useRef<AbortController | null>(null);

  const runAction = useCallback(
    async (action: 'start' | 'stop' | 'restart' | 'test') => {
      actionControllerRef.current?.abort();
      const controller = new AbortController();
      actionControllerRef.current = controller;

      setActionLoading(action);
      setTestResult(null);
      try {
        const res = await fetch(`${API_BASE_URL}/slack/gateway/${action}`, {
          method: 'POST',
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.success) {
          if (action === 'test') {
            setTestResult({ success: true, message: data.data?.message });
          }
          await fetchStatus();
        } else {
          if (action === 'test') {
            setTestResult({ success: false, message: data.error });
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTestResult(
          action === 'test'
            ? { success: false, message: s.slackGatewayApiError }
            : null,
        );
      } finally {
        setActionLoading(null);
      }
    },
    [fetchStatus, s],
  );

  useEffect(() => {
    return () => actionControllerRef.current?.abort();
  }, []);

  if (loading) {
    return (
      <div className="border-border flex items-center justify-center rounded-lg border p-4">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="border-border space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-foreground text-sm font-medium">
          {s.slackSocketModeGateway}
        </h4>
        {status && (
          <span
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
              status.state === 'running' && 'bg-green-500/10 text-green-600',
              status.state === 'stopped' && 'bg-muted text-muted-foreground',
              status.state === 'starting' && 'bg-amber-500/10 text-amber-600',
              status.state === 'error' && 'bg-red-500/10 text-red-600',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span
              className={[
                'inline-block size-2 rounded-full',
                status.state === 'running' && 'bg-green-500',
                status.state === 'stopped' && 'bg-muted-foreground',
                status.state === 'starting' && 'animate-pulse bg-amber-500',
                status.state === 'error' && 'bg-red-500',
              ]
                .filter(Boolean)
                .join(' ')}
            />
            {s[STATE_LABEL_KEYS[status.state]]}
          </span>
        )}
      </div>
      {status?.error && (
        <p className="text-destructive text-xs">{status.error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => runAction('start')}
          disabled={
            actionLoading !== null ||
            status?.state === 'running' ||
            status?.state === 'starting'
          }
          aria-label={s.slackGatewayStart}
          className="border-input bg-background hover:bg-accent rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {actionLoading === 'start' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            s.slackGatewayStart
          )}
        </button>
        <button
          onClick={() => runAction('stop')}
          disabled={actionLoading !== null || status?.state !== 'running'}
          aria-label={s.slackGatewayStop}
          className="border-input bg-background hover:bg-accent rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {actionLoading === 'stop' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            s.slackGatewayStop
          )}
        </button>
        <button
          onClick={() => runAction('restart')}
          disabled={actionLoading !== null}
          aria-label={s.slackGatewayRestart}
          className="border-input bg-background hover:bg-accent rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {actionLoading === 'restart' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            s.slackGatewayRestart
          )}
        </button>
        <button
          onClick={() => runAction('test')}
          disabled={actionLoading !== null}
          aria-label={s.slackGatewayTest}
          className="border-input bg-background hover:bg-accent rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {actionLoading === 'test' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            s.slackGatewayTest
          )}
        </button>
      </div>
      {testResult && (
        <p
          className={
            testResult.success
              ? 'text-xs text-green-600'
              : 'text-xs text-red-600'
          }
        >
          {testResult.success
            ? (testResult.message ?? s.slackGatewayTestPassed)
            : (testResult.message ?? s.slackGatewayTestFailed)}
        </p>
      )}
    </div>
  );
}
