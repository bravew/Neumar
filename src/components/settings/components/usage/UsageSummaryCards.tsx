import { Activity, CreditCard, Layers, Zap } from 'lucide-react';

import type { UsageSummary } from '@/shared/db/usage-api';
import { formatMicroCost, formatTokens } from '@/shared/db/usage-api';
import { useLanguage } from '@/shared/providers/language-provider';

interface UsageSummaryCardsProps {
  summary: UsageSummary | null;
  loading: boolean;
}

export function UsageSummaryCards({
  summary,
  loading,
}: UsageSummaryCardsProps) {
  const { t } = useLanguage();

  if (loading || !summary) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-card animate-pulse rounded-lg border p-4"
          >
            <div className="bg-muted h-4 w-20 rounded" />
            <div className="bg-muted mt-2 h-6 w-16 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const { costByBilling } = summary;

  const cards = [
    {
      label: t.settings.usageApiCost,
      value: formatMicroCost(costByBilling.api.cost),
      sub: t.settings.usageActualSpend,
      icon: CreditCard,
      color: 'text-red-500',
    },
    {
      label: t.settings.usageSubscription,
      value:
        costByBilling.subscription.requests > 0
          ? `~${formatMicroCost(costByBilling.subscription.cost)}`
          : '-',
      sub:
        costByBilling.subscription.requests > 0
          ? t.settings.usageCoveredByPlan
          : '',
      icon: Layers,
      color: 'text-muted-foreground',
    },
    {
      label: t.settings.usageTotalTokens,
      value: formatTokens(summary.totalTokens),
      sub: `In ${formatTokens(summary.totalInputTokens)} / Out ${formatTokens(summary.totalOutputTokens)} / Cache ${formatTokens(summary.totalCacheReadTokens + summary.totalCacheCreationTokens)}`,
      icon: Zap,
      color: 'text-blue-500',
    },
    {
      label: t.settings.usageRequests,
      value: String(summary.totalRequests),
      sub: '',
      icon: Activity,
      color: 'text-green-500',
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="border-border bg-card rounded-lg border p-4"
        >
          <div className="flex items-center gap-2">
            <card.icon className={`size-4 ${card.color}`} />
            <span className="text-muted-foreground text-xs">{card.label}</span>
          </div>
          <div className="mt-1 text-lg font-semibold">{card.value}</div>
          {card.sub && (
            <div className="text-muted-foreground mt-0.5 text-xs">
              {card.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
