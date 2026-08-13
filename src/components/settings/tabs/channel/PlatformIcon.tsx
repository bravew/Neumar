import { AlertTriangle, Loader2, Plug, Unplug } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import type { PermissionTier, Platform } from './types';

// ─── Platform SVG Icons ────────────────────────────────────────────────────────

export function PlatformIcon({
  id,
  className,
}: {
  id: Platform;
  className?: string;
}) {
  const cls = cn('size-7 shrink-0', className);
  switch (id) {
    case 'telegram':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#26A5E4"
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.28-.02-.12.03-2.02 1.28-5.69 3.77-.54.37-1.03.55-1.47.54-.48-.01-1.4-.27-2.09-.5-.84-.27-1.51-.42-1.45-.89.03-.24.38-.49 1.05-.74 4.11-1.79 6.85-2.97 8.24-3.54 3.93-1.62 4.75-1.9 5.27-1.91.12 0 .37.03.54.17.14.12.18.28.2.45-.01.06.01.24 0 .38z"
          />
        </svg>
      );
    case 'discord':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#5865F2"
            d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.52.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.26a18.27 18.27 0 0 0-5.4 0 12.6 12.6 0 0 0-.62-1.26.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.93 1.52.07.07 0 0 0-.03.03C1.16 8.25.5 11.97.84 15.64a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1 0-.13c.13-.09.25-.19.37-.29a.08.08 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.07 0a.08.08 0 0 1 .08.01c.12.1.25.2.37.29a.08.08 0 0 1 0 .13c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .08.03 19.83 19.83 0 0 0 6-3.03.08.08 0 0 0 .04-.05c.39-4.13-.67-7.72-2.8-10.9a.06.06 0 0 0-.04-.03zM8.02 13.33c-.95 0-1.73-.87-1.73-1.94s.76-1.94 1.73-1.94c.97 0 1.74.88 1.73 1.94 0 1.07-.77 1.94-1.73 1.94zm6.39 0c-.95 0-1.73-.87-1.73-1.94s.76-1.94 1.73-1.94c.97 0 1.74.88 1.73 1.94 0 1.07-.76 1.94-1.73 1.94z"
          />
        </svg>
      );
    case 'slack':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#E01E5A"
            d="M5.04 15.16a2.1 2.1 0 0 1-2.1 2.1 2.1 2.1 0 0 1-2.1-2.1 2.1 2.1 0 0 1 2.1-2.1h2.1v2.1zm1.06 0a2.1 2.1 0 0 1 2.1-2.1 2.1 2.1 0 0 1 2.1 2.1v5.26a2.1 2.1 0 0 1-2.1 2.1 2.1 2.1 0 0 1-2.1-2.1v-5.26z"
          />
          <path
            fill="#36C5F0"
            d="M8.2 5.04a2.1 2.1 0 0 1-2.1-2.1A2.1 2.1 0 0 1 8.2.84a2.1 2.1 0 0 1 2.1 2.1v2.1H8.2zm0 1.07a2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1H2.94a2.1 2.1 0 0 1-2.1-2.1 2.1 2.1 0 0 1 2.1-2.1H8.2z"
          />
          <path
            fill="#2EB67D"
            d="M18.96 8.2a2.1 2.1 0 0 1 2.1-2.1 2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1h-2.1V8.2zm-1.07 0a2.1 2.1 0 0 1-2.1 2.1 2.1 2.1 0 0 1-2.1-2.1V2.94a2.1 2.1 0 0 1 2.1-2.1 2.1 2.1 0 0 1 2.1 2.1V8.2z"
          />
          <path
            fill="#ECB22E"
            d="M15.8 18.96a2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1 2.1 2.1 0 0 1-2.1-2.1v-2.1h2.1zm0-1.07a2.1 2.1 0 0 1-2.1-2.1 2.1 2.1 0 0 1 2.1-2.1h5.26a2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1H15.8z"
          />
        </svg>
      );
    case 'lark':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#3370FF"
            d="M3.72 3.72c.3-.64.96-.84 1.46-.46l8.98 6.79-3.14 3.35L3.5 5.26c-.42-.54-.2-1.1.22-1.54zm16.56 16.56c-.3.64-.96.84-1.46.46l-8.98-6.79 3.14-3.35 7.52 8.14c.42.54.2 1.1-.22 1.54zM6.88 20.28c-.64.3-1.24-.04-1.34-.7l-1.5-10.98 4.4.84 1.26 9.6c.08.68-.4 1.1-.82 1.24zm10.24-16.56c.64-.3 1.24.04 1.34.7l1.5 10.98-4.4-.84-1.26-9.6c-.08-.68.4-1.1.82-1.24z"
          />
        </svg>
      );
    case 'imessage':
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label="iMessage">
          <path
            fill="#34BD5E"
            d="M12 2C6.48 2 2 5.79 2 10.4c0 2.49 1.31 4.72 3.4 6.24v3.36l3.18-1.74c1.07.31 2.21.48 3.42.48 5.52 0 10-3.79 10-8.34S17.52 2 12 2z"
          />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-label="WhatsApp">
          <path
            fill="#25D366"
            d="M17.47 14.37c-.3-.15-1.76-.87-2.03-.97s-.47-.15-.67.15c-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.49c0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.21 5.1 4.5.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12 22c-1.74 0-3.4-.45-4.85-1.3L2 22l1.32-4.93A9.94 9.94 0 0 1 2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10z"
          />
        </svg>
      );
  }
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

export function StatusBadge({ state }: { state: string | undefined }) {
  if (!state || state === 'created') return null;
  const map: Record<
    string,
    { style: string; icon: React.ReactNode; label: string }
  > = {
    running: {
      style: 'bg-green-500/10 text-green-600',
      icon: <Plug className="size-3" />,
      label: 'running',
    },
    initializing: {
      style: 'bg-amber-500/10 text-amber-600',
      icon: <Loader2 className="size-3 animate-spin" />,
      label: 'starting',
    },
    stopping: {
      style: 'bg-amber-500/10 text-amber-600',
      icon: <Loader2 className="size-3 animate-spin" />,
      label: 'stopping',
    },
    stopped: {
      style: 'bg-gray-500/10 text-gray-500',
      icon: <Unplug className="size-3" />,
      label: 'stopped',
    },
    error: {
      style: 'bg-red-500/10 text-red-600',
      icon: <AlertTriangle className="size-3" />,
      label: 'error',
    },
  };
  const cfg = map[state] ?? map.stopped;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        cfg.style,
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ─── Tier Badge ────────────────────────────────────────────────────────────────

export function TierBadge({ tier }: { tier: PermissionTier }) {
  const styles: Record<PermissionTier, string> = {
    viewer: 'bg-blue-500/10 text-blue-600',
    operator: 'bg-amber-500/10 text-amber-600',
    admin: 'bg-purple-500/10 text-purple-600',
  };
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        styles[tier],
      )}
    >
      {tier}
    </span>
  );
}
