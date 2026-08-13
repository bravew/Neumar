/**
 * PluginCard — compact tile shown in MarketplaceTab and InstalledPluginsTab.
 */

import { Package, ShieldAlert, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export type PluginCardVariant = 'marketplace' | 'installed';

export interface PluginCardItem {
  /** Composite id when installed (`scope/name`); name when discovered. */
  id: string;
  name: string;
  displayName?: string;
  version: string;
  description: string;
  scope?: string;
  signatureOk?: boolean | null;
  enabled?: boolean;
  skillCount?: number;
}

interface PluginCardProps {
  item: PluginCardItem;
  variant: PluginCardVariant;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
  onSelect?: () => void;
  pending?: boolean;
  className?: string;
}

export function PluginCard({
  item,
  variant,
  primaryActionLabel,
  secondaryActionLabel,
  onPrimaryAction,
  onSecondaryAction,
  onSelect,
  pending,
  className,
}: PluginCardProps) {
  const { t, tt } = useLanguage();
  const title = item.displayName || item.name;
  const showSig =
    variant === 'installed' &&
    (item.signatureOk === true || item.signatureOk === false);

  return (
    <div
      className={cn(
        'border-border bg-card hover:border-foreground/20 group flex flex-col gap-3 rounded-lg border p-4 transition-colors',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
          <Package className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onSelect}
            className="hover:text-foreground/80 block w-full truncate text-left text-sm font-medium"
            title={title}
          >
            {title}
          </button>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
            <span className="font-mono">v{item.version}</span>
            {item.scope ? (
              <>
                <span aria-hidden>·</span>
                <span className="capitalize">{item.scope}</span>
              </>
            ) : null}
            {typeof item.skillCount === 'number' ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {tt('plugins.card.skillsCount', { n: item.skillCount })}
                </span>
              </>
            ) : null}
          </div>
        </div>
        {showSig ? (
          item.signatureOk ? (
            <ShieldCheck
              className="size-4 shrink-0 text-emerald-500"
              aria-label="Signed"
            />
          ) : (
            <ShieldAlert
              className="size-4 shrink-0 text-amber-500"
              aria-label="Unsigned"
            />
          )
        ) : null}
      </div>

      <p className="text-muted-foreground line-clamp-2 text-xs">
        {item.description}
      </p>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant={variant === 'marketplace' ? 'default' : 'outline'}
          onClick={onPrimaryAction}
          disabled={pending}
        >
          {primaryActionLabel}
        </Button>
        {secondaryActionLabel ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onSecondaryAction}
            disabled={pending}
          >
            {secondaryActionLabel}
          </Button>
        ) : null}
        {variant === 'installed' && item.enabled === false ? (
          <span className="text-muted-foreground ml-auto text-xs">
            {t.plugins.card.disabledBadge}
          </span>
        ) : null}
      </div>
    </div>
  );
}
