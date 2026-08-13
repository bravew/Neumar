import { useEffect, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

interface CostData {
  provider: string;
  model: string;
  billing_type: string;
  api_cost: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

export function CostChart() {
  const { t } = useLanguage();
  const [data, setData] = useState<CostData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/db/dashboard/cost-summary?days=30`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : []))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t.dashboard.noData}
      </p>
    );
  }

  const totalTokens = data.reduce((sum, d) => sum + d.total_tokens, 0);
  const totalApiCost = data.reduce((sum, d) => sum + d.api_cost, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-4">
        <div className="text-foreground text-xl font-semibold">
          {t.task.costTokens.replace('{count}', formatTokens(totalTokens))}
        </div>
        {totalApiCost > 0 && (
          <div className="text-muted-foreground text-sm">
            {formatCost(totalApiCost)} {t.task.costApiCost}
          </div>
        )}
        <span className="text-muted-foreground text-sm">
          {t.dashboard.last30Days}
        </span>
      </div>
      <div className="space-y-2">
        {data.map((item) => {
          const pct =
            totalTokens > 0 ? (item.total_tokens / totalTokens) * 100 : 0;
          const isSubscription = item.billing_type === 'subscription';
          return (
            <div
              key={`${item.provider}-${item.model}-${item.billing_type}`}
              className="space-y-1"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground flex items-center gap-1.5 truncate">
                  {item.model}
                  <span className="text-muted-foreground text-xs">
                    {item.provider}
                  </span>
                  {isSubscription && (
                    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
                      {t.task.costSubscription}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {t.task.costTokensInOut
                    .replace('{input}', formatTokens(item.input_tokens))
                    .replace('{output}', formatTokens(item.output_tokens))}
                  {!isSubscription && item.api_cost > 0 && (
                    <span className="ml-1.5">
                      ({formatCost(item.api_cost)})
                    </span>
                  )}
                </span>
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
