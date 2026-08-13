/**
 * Small presentational primitives shared by the plugin detail dialog —
 * labelled sections, definition rows, tag chips, and external links.
 */

import { useState, type ReactNode } from 'react';

import { Check, Copy, ExternalLink } from 'lucide-react';

import type { MarketplaceSourceTrust } from '@/shared/hooks/useMarketplaceSources';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

export function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-foreground min-w-0 break-words',
          mono && 'font-mono',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

export function Link({ href, label }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex items-center gap-1 break-all hover:underline"
    >
      {label ?? href}
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

/** Inline copy button that flips to a check for a moment after copying. */
export function CopyButton({
  value,
  label,
  copiedLabel,
}: {
  value: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? copiedLabel : label}
    </button>
  );
}

export function Chips({ items, mono }: { items: string[]; mono?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className={cn(
            'bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]',
            mono && 'font-mono',
          )}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function TrustBadge({ trust }: { trust: MarketplaceSourceTrust }) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-medium',
        trust === 'official'
          ? 'bg-blue-500/15 text-blue-500'
          : 'bg-amber-500/15 text-amber-600',
      )}
    >
      {trust === 'official'
        ? t.plugins.sources.trustOfficial
        : t.plugins.sources.trustRestricted}
    </span>
  );
}
