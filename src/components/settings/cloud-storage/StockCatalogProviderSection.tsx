import { useCallback } from 'react';

import { ExternalLink } from 'lucide-react';

import { CloudProviderIcon } from '@/components/library';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  STOCK_PROVIDER_SETUP_GUIDE_URLS,
  STOCK_PROVIDERS_WITHOUT_API_KEY,
  type StockProvider,
} from './StockCatalogConnectDialog';
import type { CloudStorageConnection } from './types';

type CloudStorageLanguage = ReturnType<typeof useLanguage>['t']['cloudStorage'];

export function stockProviderDisplayName(
  provider: StockProvider,
  s: CloudStorageLanguage,
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

export function stockProviderDescription(
  provider: StockProvider,
  s: CloudStorageLanguage,
): string {
  switch (provider) {
    case 'unsplash':
      return s.stockProviderUnsplashDescription;
    case 'pexels':
      return s.stockProviderPexelsDescription;
    case 'pixabay':
      return s.stockProviderPixabayDescription;
    case 'coverr':
      return s.stockProviderCoverrDescription;
    case 'videvo':
      return s.stockProviderVidevoDescription;
    default:
      return s.stockProviderOpenverseDescription;
  }
}

interface StockCatalogProviderSectionProps {
  provider: StockProvider;
  name: string;
  description: string;
  connections: CloudStorageConnection[];
  onConnect: (provider: StockProvider) => void;
  onRemove?: (connection: CloudStorageConnection) => void;
  removingId?: string | null;
}

export function StockCatalogProviderSection({
  provider,
  name,
  description,
  connections,
  onConnect,
  onRemove,
  removingId,
}: StockCatalogProviderSectionProps) {
  const { t } = useLanguage();
  const setupGuideUrl = STOCK_PROVIDER_SETUP_GUIDE_URLS[provider];
  const apiKeyOptional = STOCK_PROVIDERS_WITHOUT_API_KEY.has(provider);
  const connected = connections.length > 0;

  const handleConnect = useCallback(
    () => onConnect(provider),
    [onConnect, provider],
  );

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
            {connected ? (
              <span className="rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
                {t.settings.connected}
              </span>
            ) : null}
            {apiKeyOptional ? (
              <span className="border-border text-muted-foreground rounded-full border px-1.5 py-px text-[10px] font-medium tracking-wide uppercase">
                {t.cloudStorage.apiKeyOptional}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {setupGuideUrl ? (
            <a
              href={setupGuideUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
            >
              {t.cloudStorage.setupGuide}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
          <button
            type="button"
            onClick={handleConnect}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium"
          >
            {connected ? t.cloudStorage.addConnection : t.settings.connect}
          </button>
        </div>
      </div>

      {connections.length > 0 ? (
        <ul className="border-border mt-2 ml-12 space-y-1 border-l pl-3">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate">
                {connection.displayName ?? connection.id}
              </span>
              {onRemove ? (
                <button
                  type="button"
                  onClick={() => onRemove(connection)}
                  disabled={removingId === connection.id}
                  className="text-muted-foreground hover:text-destructive text-xs disabled:opacity-50"
                >
                  {t.cloudStorage.removeConnection}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
