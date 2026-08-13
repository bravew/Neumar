import { useCallback, useEffect, useMemo, useState } from 'react';

import { ExternalLink, Loader2 } from 'lucide-react';

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
import { useLanguage } from '@/shared/providers/language-provider';

import type { CloudStorageConnection } from './types';

export type StockProvider =
  | 'openverse'
  | 'unsplash'
  | 'pexels'
  | 'pixabay'
  | 'coverr'
  | 'videvo';

export const STOCK_PROVIDERS: readonly StockProvider[] = [
  'openverse',
  'unsplash',
  'pexels',
  'pixabay',
  'coverr',
  'videvo',
];

// Each catalog hands out API keys from a different self-service URL. Surface
// it as a "How to get an API key" link in the dialog so the user doesn't
// have to hunt for the right developer page.
export const STOCK_PROVIDER_SETUP_GUIDE_URLS: Record<
  StockProvider,
  string | null
> = {
  openverse: null,
  unsplash: 'https://unsplash.com/oauth/applications',
  pexels: 'https://www.pexels.com/api/new/',
  pixabay: 'https://pixabay.com/api/docs/',
  coverr: 'https://coverr.co/developers',
  videvo: 'https://www.videvo.net/api/',
};

export const STOCK_PROVIDERS_WITHOUT_API_KEY: ReadonlySet<StockProvider> =
  new Set(['openverse']);

interface StockCatalogConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (connection: CloudStorageConnection) => void;
  initialProvider?: StockProvider;
  lockProvider?: boolean;
}

interface TestResult {
  ok: boolean;
  provider: string;
  status?: number;
  errorCode?: string;
}

const INPUT_CLASS =
  'border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-full rounded-md border px-3 text-sm focus:ring-2 focus:outline-none';

export function StockCatalogConnectDialog({
  open,
  onOpenChange,
  onCreated,
  initialProvider,
  lockProvider,
}: StockCatalogConnectDialogProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  const [provider, setProvider] = useState<StockProvider>(
    initialProvider ?? 'openverse',
  );

  // Re-sync the provider when the dialog is re-opened with a different
  // `initialProvider`, so the per-provider Connect buttons always land in
  // the right state on the next open.
  useEffect(() => {
    if (!open) return;
    if (initialProvider) setProvider(initialProvider);
  }, [open, initialProvider]);
  const [displayName, setDisplayName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apiKeyRequired = !STOCK_PROVIDERS_WITHOUT_API_KEY.has(provider);
  const providerLabel = useMemo(
    () => stockProviderLabel(provider, s),
    [provider, s],
  );
  const setupGuideUrl = STOCK_PROVIDER_SETUP_GUIDE_URLS[provider];

  const testConnection = useCallback(async (): Promise<TestResult | null> => {
    setBusy(true);
    setError('');
    setTestResult(null);
    try {
      const result = await requestConnectionTest(provider, apiKey);
      setTestResult(result);
      if (!result.ok) {
        setError(result.errorCode ?? s.connectionTestFailed);
        return null;
      }
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : s.connectionTestFailed);
      return null;
    } finally {
      setBusy(false);
    }
  }, [apiKey, provider, s.connectionTestFailed]);

  const createConnection = useCallback(async () => {
    setBusy(true);
    setError('');
    setTestResult(null);
    try {
      const result = await requestConnectionTest(provider, apiKey);
      setTestResult(result);
      if (!result.ok) {
        setError(result.errorCode ?? s.connectionTestFailed);
        return;
      }

      const body = await postJson<{ item: CloudStorageConnection }>(
        '/connections',
        {
          provider,
          kind: 'stock-catalog',
          displayName: displayName.trim() || undefined,
          credential: { apiKey: apiKey || undefined },
          accessLevel: 'read',
        },
      );
      onCreated(body.item);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : s.connectionCreateError);
    } finally {
      setBusy(false);
    }
  }, [
    apiKey,
    displayName,
    onCreated,
    onOpenChange,
    provider,
    s.connectionCreateError,
    s.connectionTestFailed,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.stockCatalogTitle}</DialogTitle>
          <DialogDescription>{s.stockCatalogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {lockProvider ? null : (
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">{s.provider}</span>
              <select
                className={INPUT_CLASS}
                value={provider}
                onChange={(event) =>
                  setProvider(event.target.value as StockProvider)
                }
              >
                {STOCK_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {stockProviderLabel(p, s)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{s.displayName}</span>
            <input
              className={INPUT_CLASS}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={providerLabel}
            />
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="flex items-center justify-between">
              <span className="font-medium">
                {apiKeyRequired ? s.apiKey : s.apiKeyOptional}
              </span>
              {setupGuideUrl ? (
                <a
                  href={setupGuideUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                >
                  {s.setupGuide}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </span>
            <input
              className={INPUT_CLASS}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
            />
          </label>

          {testResult?.ok && (
            <p className="text-sm text-emerald-600">{s.connectionTestPassed}</p>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {s.cancel}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || (apiKeyRequired && !apiKey)}
            onClick={testConnection}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {s.testConnection}
          </Button>
          <Button
            type="button"
            disabled={busy || (apiKeyRequired && !apiKey)}
            onClick={createConnection}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {s.createConnection}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function stockProviderLabel(
  provider: StockProvider,
  s: ReturnType<typeof useLanguage>['t']['cloudStorage'],
): string {
  switch (provider) {
    case 'unsplash':
      return s.providerUnsplash;
    case 'pexels':
      return s.providerPexels;
    case 'pixabay':
      return s.providerPixabay;
    case 'coverr':
      return s.providerCoverr;
    case 'videvo':
      return s.providerVidevo;
    default:
      return s.providerOpenVerse;
  }
}

function requestConnectionTest(
  provider: StockProvider,
  apiKey: string,
): Promise<TestResult> {
  return postJson<TestResult>('/connections/test', {
    provider,
    apiKey: apiKey || undefined,
  });
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/cloud-storage${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}
