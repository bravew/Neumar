/**
 * Integration Card
 *
 * Reusable card component for displaying and managing an OAuth integration.
 * Shows connection status, granted scopes, and connect/disconnect actions.
 */

import { useState } from 'react';

import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Unplug,
  X,
} from 'lucide-react';

import type { OAuthConnection, OAuthProvider } from '@/shared/hooks/useAuth';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { IntegrationCardDetails } from './IntegrationCardDetails';

// Provider metadata for display
const PROVIDER_META: Record<
  OAuthProvider,
  { name: string; icon: React.ReactNode; color: string }
> = {
  google: {
    name: 'Google',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
    ),
    color: 'text-blue-500',
  },
  slack: {
    name: 'Slack',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
          fill="#E01E5A"
        />
        <path
          d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
          fill="#36C5F0"
        />
        <path
          d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
          fill="#2EB67D"
        />
        <path
          d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z"
          fill="#ECB22E"
        />
      </svg>
    ),
    color: 'text-purple-500',
  },
  box: {
    name: 'Box',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#0061D5">
        <rect x="2" y="6" width="20" height="12" rx="2" fill="#0061D5" />
      </svg>
    ),
    color: 'text-[#0061D5]',
  },
  dropbox: {
    name: 'Dropbox',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#0061FF">
        <path d="M6 2 0 6l6 4 6-4-6-4zm12 0-6 4 6 4 6-4-6-4zM0 14l6 4 6-4-6-4-6 4zm18-4-6 4 6 4 6-4-6-4zM6 19l6 4 6-4-6-4-6 4z" />
      </svg>
    ),
    color: 'text-[#0061FF]',
  },
  onedrive: {
    name: 'OneDrive',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#0364B8">
        <path d="M14 9a5 5 0 0 0-9.6-1.5A4 4 0 0 0 1 11a4 4 0 0 0 4 4h13a4 4 0 0 0 4-4 4 4 0 0 0-4-4 5 5 0 0 0-4-1z" />
      </svg>
    ),
    color: 'text-[#0364B8]',
  },
  notion: {
    name: 'Notion',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L2.848 2.298c-.467.047-.56.28-.374.466l1.985 1.444zM5.251 7.31v13.93c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.934-.56.934-1.166V6.376c0-.606-.233-.933-.747-.886l-15.177.84c-.56.047-.747.327-.747.98zM18.77 7.87c.094.42 0 .84-.42.887l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.747 0-.934-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.222.187c-.094-.187 0-.653.327-.747l.84-.233V9.854L7.03 9.76c-.094-.42.14-1.026.793-1.073l3.456-.234 4.764 7.28V9.481l-1.215-.14c-.094-.514.28-.887.747-.933l3.196-.54z" />
      </svg>
    ),
    color: 'text-zinc-700 dark:text-zinc-300',
  },
  site: {
    name: 'Neumar',
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    color: 'text-primary',
  },
};

interface IntegrationCardProps {
  provider: OAuthProvider;
  connection: OAuthConnection | null;
  available: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  /** Optional: service-specific labels (e.g., "Gmail", "Calendar") */
  label?: string;
  /** Optional: description of what this integration provides */
  description?: string;
}

export function IntegrationCard({
  provider,
  connection,
  available,
  onConnect,
  onDisconnect,
  label,
  description,
}: IntegrationCardProps) {
  const { t } = useLanguage();
  const messages = t.connectors;
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const meta = PROVIDER_META[provider];
  const isConnected = connection?.status === 'active';
  const displayName = label ?? meta.name;

  const handleAction = async () => {
    setLoading(true);
    try {
      if (isConnected) {
        await onDisconnect();
      } else {
        await onConnect();
      }
    } catch {
      // Error handled by parent
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        'border-border rounded-lg border transition-all',
        isConnected ? 'bg-muted/30' : 'bg-background',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Provider icon */}
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            meta.color,
          )}
        >
          {meta.icon}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground text-sm font-medium">
              {displayName}
            </span>
            {isConnected && (
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                <Check className="size-2.5" />
                {messages.card.statusConnected}
              </span>
            )}
          </div>
          {isConnected && connection ? (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {connection.accountEmail}
            </p>
          ) : description ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {description}
            </p>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {isConnected && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground p-1 transition-colors"
              aria-label={messages.card.openLabel.replace(
                '{name}',
                displayName,
              )}
            >
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          )}
          {available && (
            <button
              onClick={handleAction}
              disabled={loading}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                isConnected
                  ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
              aria-label={
                isConnected
                  ? `${messages.auth.disconnect} ${displayName}`
                  : `${messages.auth.connect} ${displayName}`
              }
            >
              {loading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : isConnected ? (
                <Unplug className="size-3" />
              ) : (
                <ExternalLink className="size-3" />
              )}
              {loading
                ? isConnected
                  ? messages.auth.disconnecting
                  : messages.auth.connecting
                : isConnected
                  ? messages.auth.disconnect
                  : messages.auth.connect}
            </button>
          )}
          {!available && !isConnected && (
            <span className="text-muted-foreground/50 text-xs">
              <X className="inline size-3" />{' '}
              {messages.composioCard.notConfiguredLabel}
            </span>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {isConnected && expanded && connection && (
        <IntegrationCardDetails connection={connection} messages={messages} />
      )}
    </div>
  );
}
