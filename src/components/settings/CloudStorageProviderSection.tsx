import { useCallback, useState } from 'react';

/**
 * Cloud-storage provider section (Box / Dropbox / OneDrive).
 *
 * Renders a single Settings card that lets the user enter their OAuth
 * app credentials and, once configured, initiate the PKCE flow via the
 * shared `useAuth` hook. Disconnect tears down the persisted tokens.
 */
import { Loader2 } from 'lucide-react';

import { CloudProviderIcon } from '@/components/library';
import { useAuth, type OAuthProvider } from '@/shared/hooks/useAuth';
import { useLanguage } from '@/shared/providers/language-provider';

import { OAuthCredentialsForm } from './OAuthCredentialsForm';

type CloudProvider = 'box' | 'dropbox' | 'onedrive';

interface CloudStorageProviderSectionProps {
  provider: CloudProvider;
  name: string;
  description: string;
  setupGuideUrl: string;
}

export function CloudStorageProviderSection({
  provider,
  name,
  description,
  setupGuideUrl,
}: CloudStorageProviderSectionProps) {
  const { t } = useLanguage();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(false);

  const connection = auth.getConnection(provider as OAuthProvider);
  const connected = connection?.status === 'active';

  const handleConnect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await auth.connect(provider as OAuthProvider);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t.settings.oauthStartFailed,
      );
    } finally {
      setBusy(false);
    }
  }, [auth, provider, t.settings.oauthStartFailed]);

  const handleDisconnect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await auth.disconnect(provider as OAuthProvider);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t.settings.oauthDisconnectFailed,
      );
    } finally {
      setBusy(false);
    }
  }, [auth, provider, t.settings.oauthDisconnectFailed]);

  const [showCredentials, setShowCredentials] = useState(false);
  // Auto-expand the credentials form on first render when nothing is
  // configured yet — saves a click for the common "first-time setup" path.
  // Once configured, collapse by default and surface a "Configure" toggle.
  const credentialsOpen = showCredentials || (!configured && !connected);

  return (
    <div className="group/row hover:bg-muted/40 rounded-md px-3 py-2.5 transition-colors">
      <div className="flex items-center gap-3">
        <div className="bg-background ring-border/60 flex size-9 shrink-0 items-center justify-center rounded-md ring-1">
          <CloudProviderIcon provider={provider} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-foreground truncate text-sm font-medium">
              {name}
            </p>
            {connected && (
              <span className="rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
                {t.settings.connected}
              </span>
            )}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {connection?.displayName || connection?.accountEmail || description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {configured && !connected && (
            <button
              type="button"
              onClick={() => setShowCredentials((v) => !v)}
              className="text-muted-foreground hover:text-foreground rounded px-2 py-1 text-xs"
            >
              {t.settings.configure}
            </button>
          )}
          {connected ? (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                t.settings.disconnect
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              disabled={busy || !configured}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              title={
                !configured ? t.settings.oauthCredentialsRequired : undefined
              }
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                t.settings.connect
              )}
            </button>
          )}
        </div>
      </div>

      {credentialsOpen && (
        <div className="mt-3 pl-12">
          <OAuthCredentialsForm
            provider={provider}
            setupGuideUrl={setupGuideUrl}
            onConfigured={(c) => {
              setConfigured(c);
              if (c) setShowCredentials(false);
            }}
          />
        </div>
      )}

      {error && <p className="mt-2 pl-12 text-xs text-red-600">{error}</p>}
    </div>
  );
}
