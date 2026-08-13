import { useState } from 'react';

import { Trash2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface Identity {
  id: string;
  user_alias: string | null;
  permission_tier: string;
  token_budget: number;
  tokens_used_today: number;
  channels: { channel_id: string; channel_username: string | null }[];
}

interface IdentityTableProps {
  identities: Identity[];
  onRefresh: () => void;
}

export function IdentityTable({ identities, onRefresh }: IdentityTableProps) {
  const { t } = useLanguage();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setConfirmId(null);
    setDeleting(id);
    try {
      await fetch(`${API_BASE_URL}/gateway/identities/${id}`, {
        method: 'DELETE',
      });
      onRefresh();
    } finally {
      setDeleting(null);
    }
  };

  const tierBadge = (tier: string) => {
    const styles: Record<string, string> = {
      viewer: 'bg-blue-500/10 text-blue-600',
      operator: 'bg-amber-500/10 text-amber-600',
      admin: 'bg-purple-500/10 text-purple-600',
    };
    return (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-medium',
          styles[tier] ?? 'bg-gray-500/10 text-gray-500',
        )}
      >
        {tier}
      </span>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            {t.settings.gatewayIdentities}
          </h3>
          <p className="text-muted-foreground text-xs">
            {t.settings.gatewayIdentitiesDescription}
          </p>
        </div>
      </div>

      <div className="border-border divide-border divide-y rounded-lg border">
        {identities.map((identity) => (
          <div
            key={identity.id}
            className="flex items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="text-foreground text-sm font-medium">
                {identity.user_alias || identity.id.slice(0, 8)}
              </span>
              {tierBadge(identity.permission_tier)}
              <span className="text-muted-foreground text-xs">
                {identity.channels
                  .map((c) => `${c.channel_id}:${c.channel_username ?? '?'}`)
                  .join(', ') || t.settings.gatewayIdentityNoChannels}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs">
                {identity.tokens_used_today.toLocaleString()}{' '}
                {t.settings.gatewayIdentityTokensSuffix}
              </span>
              {confirmId === identity.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDelete(identity.id)}
                    className="cursor-pointer rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-500/20"
                  >
                    {t.settings.gatewayIdentityDeleteConfirm}
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-muted-foreground hover:text-foreground cursor-pointer text-xs"
                  >
                    {t.settings.gatewayCancel}
                  </button>
                </div>
              ) : (
                <button
                  aria-label={t.settings.gatewayIdentityDeleteConfirm}
                  onClick={() => setConfirmId(identity.id)}
                  disabled={deleting === identity.id}
                  className="text-muted-foreground cursor-pointer hover:text-red-500 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
        {identities.length === 0 && (
          <div className="text-muted-foreground px-4 py-6 text-center text-sm">
            {t.settings.gatewayIdentitiesEmpty}
          </div>
        )}
      </div>
    </div>
  );
}
