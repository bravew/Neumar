import { useEffect, useRef, useState } from 'react';

import { ExternalLink, Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { openOAuthWindow } from '@/shared/lib/open-oauth-window';

import { defaultConnectorMessages, type ConnectorMessages } from './messages';
import type { ConnectorDetail } from './types';

interface ConnectStartResponse {
  kind?: string;
  redirectUrl?: string;
  error?: { message?: string } | string;
}

const OAUTH_POLL_INTERVAL_MS = 2000;
const OAUTH_POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function pollUntilConnected(
  connectorId: string,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + OAUTH_POLL_TIMEOUT_MS;
  while (Date.now() < deadline && !signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, OAUTH_POLL_INTERVAL_MS));
    if (signal.aborted) return;
    try {
      const res = await fetch(`${API_BASE_URL}/connectors/${connectorId}`, {
        signal,
      });
      if (!res.ok) continue;
      const detail = (await res.json()) as { status?: string };
      if (detail.status === 'connected') return;
    } catch {
      /* keep polling */
    }
  }
}

export function ConnectorAuthLauncher({
  detail,
  messages = defaultConnectorMessages,
}: {
  detail: ConnectorDetail;
  messages?: ConnectorMessages;
}) {
  const [busy, setBusy] = useState<null | 'connecting' | 'disconnecting'>(null);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const isConnected = detail.status === 'connected';

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  async function connect() {
    setBusy('connecting');
    setError('');
    // Open the popup synchronously at click time so the browser popup blocker
    // doesn't kill it after the fetch() async hop. The handle's load() call
    // navigates the window once we have the redirect URL.
    const popup = openOAuthWindow({
      label: `oauth-${detail.id}`,
      title: `Authorize ${detail.name}`,
    });
    try {
      const res = await fetch(
        `${API_BASE_URL}/connectors/${detail.id}/connect`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-neuma-admin-origin': 'desktop',
          },
          body: JSON.stringify({
            callbackBaseUrl: API_BASE_URL,
            scopeKey: 'desktop:local',
            userId: 'desktop',
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as ConnectStartResponse;
      if (!res.ok) {
        await popup.close();
        const message =
          typeof body.error === 'string'
            ? body.error
            : (body.error?.message ?? `HTTP ${res.status}`);
        throw new Error(message);
      }
      if (!body.redirectUrl) {
        await popup.close();
        throw new Error(messages.auth.missingRedirect);
      }
      await popup.load(body.redirectUrl);
      pollAbortRef.current?.abort();
      const controller = new AbortController();
      pollAbortRef.current = controller;
      void pollUntilConnected(detail.id, controller.signal).finally(() => {
        if (controller.signal.aborted) return;
        void popup.close();
        window.dispatchEvent(new CustomEvent('connector-connection-changed'));
      });
    } catch (err) {
      await popup.close();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function performDisconnect() {
    setConfirmOpen(false);
    setBusy('disconnecting');
    setError('');
    try {
      const res = await fetch(
        `${API_BASE_URL}/connectors/${detail.id}/connection`,
        {
          method: 'DELETE',
          headers: { 'x-neuma-admin-origin': 'desktop' },
        },
      );
      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => ({}))) as ConnectStartResponse;
        const message =
          typeof body.error === 'string'
            ? body.error
            : (body.error?.message ?? `HTTP ${res.status}`);
        throw new Error(message);
      }
      window.dispatchEvent(new CustomEvent('connector-connection-changed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (detail.provider === 'native') {
    return (
      <p className="text-muted-foreground text-xs">
        {messages.auth.nativeHelp}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {isConnected ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={busy !== null}
          >
            <Unplug className="size-4" />
            {busy === 'disconnecting'
              ? messages.auth.disconnecting
              : messages.auth.disconnect}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => void connect()}
            disabled={busy !== null}
          >
            <ExternalLink className="size-4" />
            {busy === 'connecting'
              ? messages.auth.connecting
              : messages.auth.connect}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{messages.auth.disconnect}</DialogTitle>
            <DialogDescription>
              {messages.auth.disconnectConfirm.replace('{name}', detail.name)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              {messages.auth.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void performDisconnect()}
            >
              {messages.auth.disconnect}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
