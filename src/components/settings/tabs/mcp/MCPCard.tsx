import { useState } from 'react';

import {
  CheckCircle2,
  Loader2,
  LogIn,
  MoreHorizontal,
  Settings2,
  Trash2,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { MCPServerUI } from '../../types';

type AuthStatus =
  | 'authenticated'
  | 'requires-auth'
  | 'configured'
  | 'unconfigured';

function getAuthStatus(server: MCPServerUI): AuthStatus {
  if (server.type === 'stdio') {
    return server.command ? 'configured' : 'unconfigured';
  }
  // http / sse
  if (server.requiresOAuth) {
    const hasToken =
      !!server.headers?.['Authorization'] ||
      server.oauth?.tokenStore === 'encrypted';
    return hasToken ? 'authenticated' : 'requires-auth';
  }
  return server.url ? 'configured' : 'unconfigured';
}

export function MCPCard({
  server,
  onConfigure,
  onConnectOAuth,
  onDelete,
  onDismissAuthError,
  connecting = false,
  authError,
}: {
  server: MCPServerUI;
  onConfigure: () => void;
  /** Called when the "Connect OAuth" button is clicked. Defaults to onConfigure. */
  onConnectOAuth?: () => void;
  onDelete: () => void;
  onDismissAuthError?: () => void;
  /** True while an OAuth flow is in progress for this server. */
  connecting?: boolean;
  authError?: string;
}) {
  const { t } = useLanguage();
  const [showMenu, setShowMenu] = useState(false);

  const status = getAuthStatus(server);

  return (
    <div className="border-border bg-background hover:border-foreground/20 relative flex flex-col rounded-xl border p-4 transition-colors">
      <div className="mb-2 flex flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {server.icon && (
            <img
              src={server.icon}
              alt=""
              className="size-5 shrink-0 rounded"
              aria-hidden="true"
            />
          )}
          <span className="text-foreground truncate text-sm font-medium">
            {server.name}
          </span>
        </div>
        <AuthBadge status={status} t={t} />
      </div>

      <div className="text-muted-foreground mb-4 flex-1 space-y-2 text-xs">
        <p>
          {server.type === 'stdio'
            ? t.settings.mcpTypeStdio
            : server.type === 'sse'
              ? t.settings.mcpTypeSse || 'SSE'
              : t.settings.mcpTypeHttp}
        </p>
        {server.advertisedToolCount !== undefined && (
          <p>
            {t.settings.mcpToolCountStatus
              .replace('{advertised}', String(server.advertisedToolCount))
              .replace('{authorized}', String(server.authorizedToolCount ?? 0))}
          </p>
        )}
        {authError && (
          <div className="border-destructive/25 bg-destructive/10 text-destructive rounded-md border p-2">
            <p className="break-words">{authError}</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={onConnectOAuth ?? onConfigure}
                className="font-medium underline underline-offset-2"
              >
                {t.task.retry}
              </button>
              {onDismissAuthError && (
                <button
                  type="button"
                  onClick={onDismissAuthError}
                  className="font-medium underline underline-offset-2"
                >
                  {t.task.cancel}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-border flex items-center justify-between border-t pt-3">
        {/* Connect button for OAuth servers that haven't been authenticated */}
        {status === 'requires-auth' ? (
          <button
            onClick={connecting ? undefined : (onConnectOAuth ?? onConfigure)}
            disabled={connecting}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              connecting
                ? 'cursor-default bg-amber-500/10 text-amber-600/50 dark:text-amber-400/50'
                : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400',
            )}
            aria-label={`${t.settings.mcpConnectOAuth} ${server.name}`}
          >
            {connecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <LogIn className="size-3.5" />
            )}
            {connecting ? t.settings.mcpConnecting : t.settings.mcpConnectOAuth}
          </button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={onConfigure}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1.5 transition-colors"
            title={t.settings.mcpGoToConfigure}
            aria-label={`${t.settings.mcpGoToConfigure} ${server.name}`}
          >
            <Settings2 className="size-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1.5 transition-colors"
              aria-label={`More options for ${server.name}`}
            >
              <MoreHorizontal className="size-4" />
            </button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="border-border bg-popover absolute right-0 bottom-full z-20 mb-1 min-w-max rounded-lg border py-1 shadow-lg">
                  <button
                    onClick={() => {
                      onDelete();
                      setShowMenu(false);
                    }}
                    className="hover:bg-destructive/10 text-destructive flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors"
                  >
                    <Trash2 className="size-3.5 shrink-0" />
                    {t.settings.mcpDeleteServer}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthBadge({
  status,
  t,
}: {
  status: AuthStatus;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  if (status === 'authenticated') {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3" />
        {t.settings.mcpAuthConnected}
      </span>
    );
  }
  if (status === 'requires-auth') {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
        <LogIn className="size-3" />
        {t.settings.mcpRequiresAuth}
      </span>
    );
  }
  if (status === 'unconfigured') {
    return (
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
          'bg-muted text-muted-foreground',
        )}
      >
        {t.settings.mcpNotConfigured}
      </span>
    );
  }
  return null;
}
