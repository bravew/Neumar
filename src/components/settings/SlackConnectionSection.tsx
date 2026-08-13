/**
 * Slack Connection Section
 *
 * Manages Slack platform connectivity via OAuth or manual bot/user tokens.
 * When connected, shows the integration card and socket mode configuration.
 * When not connected, provides a manual token entry flow.
 */

import { useEffect, useRef, useState } from 'react';

import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';

import { IntegrationCard } from '@/components/auth/IntegrationCard';
import { OAuthCredentialsForm } from '@/components/settings/OAuthCredentialsForm';
import { SlackGatewaySettings } from '@/components/settings/SlackGatewaySettings';
import { API_BASE_URL } from '@/config';
import { useAuth } from '@/shared/hooks/useAuth';
import { useLanguage } from '@/shared/providers/language-provider';

const INPUT_CLASS =
  'border-input bg-background text-foreground placeholder:text-muted-foreground block w-full rounded-md border px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1';

export function SlackConnectionSection() {
  const { t } = useLanguage();
  const auth = useAuth();

  const [appToken, setAppToken] = useState('');
  const [botToken, setBotToken] = useState('');
  const [userToken, setUserToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [hasAppToken, setHasAppToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const slackConnection = auth.getConnection('slack');
  const isConnected = slackConnection?.status === 'active';

  // Load Slack config when connected
  useEffect(() => {
    if (!isConnected) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/slack/config`, {
          signal: controller.signal,
        });
        if (!res.ok || controller.signal.aborted) return;
        const { data } = await res.json();
        if (data && !controller.signal.aborted) {
          const hasApp = !!data.appToken && String(data.appToken).length > 0;
          setHasAppToken(hasApp);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    })();
    return () => controller.abort();
  }, [isConnected]);

  const saveControllerRef = useRef<AbortController | null>(null);

  const handleConfigSave = async () => {
    saveControllerRef.current?.abort();
    const controller = new AbortController();
    saveControllerRef.current = controller;

    setSaving(true);
    setSaveError('');
    try {
      const payload: Record<string, string> = {};
      if (appToken) payload.appToken = appToken;
      if (botToken) payload.botToken = botToken;
      if (userToken) payload.userToken = userToken;
      const res = await fetch(`${API_BASE_URL}/slack/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setHasAppToken(!!(payload.appToken || hasAppToken));
        if (payload.appToken) setAppToken('');
      } else {
        setSaveError(data.error ?? 'Failed to save');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setSaveError('Failed to connect to API');
    } finally {
      setSaving(false);
    }
  };

  const connectControllerRef = useRef<AbortController | null>(null);

  const handleManualConnect = async () => {
    connectControllerRef.current?.abort();
    const controller = new AbortController();
    connectControllerRef.current = controller;

    setConnecting(true);
    setConnectError('');
    try {
      const payload: { botToken: string; userToken?: string } = {
        botToken,
      };
      if (userToken) payload.userToken = userToken;
      const res = await fetch(`${API_BASE_URL}/slack/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setBotToken('');
        setUserToken('');
        await auth.refresh();
      } else {
        setConnectError(data.error ?? 'Failed to connect');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setConnectError('Failed to connect to API');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="border-border rounded-lg border">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="border-border/50 flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
          <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-foreground text-sm font-medium">Slack</p>
          <p className="text-muted-foreground text-xs">
            {t.settings.integrationSlack}
          </p>
        </div>
        {isConnected && (
          <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
            {t.settings.authorized}
          </span>
        )}
        <ChevronDown
          className={`text-muted-foreground size-4 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="border-border/50 border-t">
          {isConnected ? (
            <>
              <div className="px-4 py-3">
                <IntegrationCard
                  provider="slack"
                  connection={auth.getConnection('slack')}
                  available={auth.availableProviders.includes('slack')}
                  onConnect={() => auth.connect('slack')}
                  onDisconnect={() => auth.disconnect('slack')}
                  description={t.settings.integrationSlack}
                />
              </div>
              <div className="border-border/50 space-y-3 border-t px-4 py-3">
                <h4 className="text-foreground text-sm font-medium">
                  {t.settings.slackSocketMode}
                </h4>
                <div>
                  <label
                    htmlFor="slack-app-token"
                    className="text-foreground/80 mb-1 block text-sm font-medium"
                  >
                    {t.settings.slackAppToken}
                  </label>
                  <p className="text-muted-foreground mb-1 text-xs">
                    {t.settings.slackAppTokenHelp}
                  </p>
                  <input
                    id="slack-app-token"
                    type="password"
                    value={appToken}
                    onChange={(e) => setAppToken(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="xapp-..."
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleConfigSave}
                    disabled={saving || !appToken}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      t.settings.connectorSave
                    )}
                  </button>
                  {saveError && (
                    <span className="text-sm text-red-600">{saveError}</span>
                  )}
                </div>
                {hasAppToken && <SlackGatewaySettings />}
              </div>
            </>
          ) : (
            <div className="space-y-3 px-4 py-3">
              <OAuthCredentialsForm
                provider="slack"
                setupGuideUrl="https://api.slack.com/apps"
                onConfigured={() => auth.refresh()}
              />
              <div className="border-border/50 border-t pt-3" />
              <p className="text-muted-foreground text-xs">
                {t.settings.slackManualDescription}{' '}
                <a
                  href="https://docs.slack.dev/authentication/installing-with-oauth/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5 underline underline-offset-2"
                >
                  {t.settings.slackOAuthSetupDoc}
                  <ExternalLink className="size-3" />
                </a>
              </p>
              <div className="space-y-2">
                <div>
                  <label
                    htmlFor="slack-user-token"
                    className="text-foreground/80 mb-0.5 block text-xs font-medium"
                  >
                    {t.settings.slackUserTokenOptional}
                  </label>
                  <input
                    id="slack-user-token"
                    type="password"
                    value={userToken}
                    onChange={(e) => setUserToken(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="xoxp-..."
                  />
                </div>
                <div>
                  <label
                    htmlFor="slack-bot-token"
                    className="text-foreground/80 mb-0.5 block text-xs font-medium"
                  >
                    {t.settings.slackBotToken}
                  </label>
                  <input
                    id="slack-bot-token"
                    type="password"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="xoxb-..."
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleManualConnect}
                  disabled={connecting || !botToken}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {connecting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    t.settings.slackConnect
                  )}
                </button>
                {connectError && (
                  <span className="text-sm text-red-600">{connectError}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
