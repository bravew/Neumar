/**
 * OAuth Credentials Form
 *
 * Allows users to provide their own OAuth app credentials for providers
 * that require client_secret (Slack, Notion). Credentials are stored
 * locally in the settings DB and never leave the device.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Check, ExternalLink, Loader2, Trash2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

const INPUT_CLASS =
  'border-input bg-background text-foreground placeholder:text-muted-foreground block w-full rounded-md border px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1';

interface OAuthCredentialsFormProps {
  provider: 'slack' | 'notion' | 'box' | 'dropbox' | 'onedrive';
  setupGuideUrl: string;
  onConfigured?: (configured: boolean) => void;
  /** Override the per-provider default. PKCE-only providers (dropbox,
   *  onedrive) hide the client_secret field; Box/Slack/Notion require it. */
  requiresSecret?: boolean;
}

const PROVIDER_REQUIRES_SECRET: Record<
  OAuthCredentialsFormProps['provider'],
  boolean
> = {
  slack: true,
  notion: true,
  box: true,
  dropbox: false,
  onedrive: false,
};

export function OAuthCredentialsForm({
  provider,
  setupGuideUrl,
  onConfigured,
  requiresSecret = PROVIDER_REQUIRES_SECRET[provider],
}: OAuthCredentialsFormProps) {
  const { t } = useLanguage();

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [configured, setConfigured] = useState(false);
  const [existingClientId, setExistingClientId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const controllerRef = useRef<AbortController | null>(null);
  const onConfiguredRef = useRef(onConfigured);
  onConfiguredRef.current = onConfigured;

  // Load current state
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/auth/credentials/${provider}`,
          { signal: controller.signal },
        );
        if (!res.ok || controller.signal.aborted) return;
        const data = await res.json();
        if (!controller.signal.aborted) {
          setConfigured(data.configured);
          setExistingClientId(data.clientId ?? '');
          onConfiguredRef.current?.(data.configured);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    })();
    return () => controller.abort();
  }, [provider]);

  const handleSave = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/credentials/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId.trim(),
          ...(requiresSecret ? { clientSecret: clientSecret.trim() } : {}),
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (res.ok) {
        setConfigured(true);
        setExistingClientId(clientId.trim());
        setClientId('');
        setClientSecret('');
        setSaved(true);
        onConfiguredRef.current?.(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to save');
      }
      setSaving(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('Failed to connect to API');
      setSaving(false);
    }
  }, [provider, clientId, clientSecret]);

  const handleRemove = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const res = await fetch(`${API_BASE_URL}/auth/credentials/${provider}`, {
        method: 'DELETE',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (res.ok) {
        setConfigured(false);
        setExistingClientId('');
        onConfiguredRef.current?.(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }, [provider]);

  const setupGuide =
    provider === 'slack'
      ? t.settings.oauthSlackSetupGuide
      : provider === 'notion'
        ? t.settings.oauthNotionSetupGuide
        : provider === 'box'
          ? t.settings.oauthBoxSetupGuide
          : provider === 'dropbox'
            ? t.settings.oauthDropboxSetupGuide
            : t.settings.oauthOneDriveSetupGuide;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-foreground text-xs font-medium">
          {t.settings.oauthCredentials}
        </h4>
        {configured && (
          <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
            {t.settings.oauthCredentialsConfigured}
          </span>
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        {setupGuide}{' '}
        <a
          href={setupGuideUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5 underline underline-offset-2"
        >
          {t.settings.slackOAuthSetupDoc}
          <ExternalLink className="size-3" />
        </a>
      </p>

      {configured ? (
        <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2 dark:border-green-900 dark:bg-green-950">
          <div>
            <p className="text-foreground text-xs font-medium">
              {t.settings.oauthClientId}: {existingClientId.slice(0, 12)}…
            </p>
            {requiresSecret && (
              <p className="text-muted-foreground text-xs">
                {t.settings.oauthClientSecret}: ••••••••
              </p>
            )}
          </div>
          <button
            onClick={handleRemove}
            className="text-muted-foreground hover:text-destructive p-1 transition-colors"
            title={t.settings.oauthRemoveCredentials}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={INPUT_CLASS}
              placeholder={t.settings.oauthClientId}
            />
            {requiresSecret && (
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className={INPUT_CLASS}
                placeholder={t.settings.oauthClientSecret}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={
                saving ||
                !clientId.trim() ||
                (requiresSecret && !clientSecret.trim())
              }
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : saved ? (
                <span className="flex items-center gap-1">
                  <Check className="size-3" />
                  {t.settings.oauthCredentialsSaved}
                </span>
              ) : (
                t.settings.oauthSaveCredentials
              )}
            </button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
