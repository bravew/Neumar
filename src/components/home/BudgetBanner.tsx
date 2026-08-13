/**
 * BudgetBanner
 *
 * Shows an inline banner on the Home page when any budget policy is at
 * soft (≥75%), urgent (≥90%), or blocked (≥100%) utilization.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AlertTriangle, XCircle } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

type Severity = 'ok' | 'soft' | 'urgent' | 'blocked';

interface StatusItem {
  policy: { name: string; limit_usd: number };
  currentSpend: number;
  percentUsed: number;
  severity: Severity;
}

const POLL_INTERVAL_MS = 60_000;

export function BudgetBanner() {
  const { t } = useLanguage();
  const [worst, setWorst] = useState<StatusItem | null>(null);
  const mountedRef = useRef(true);

  const check = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE_URL}/budget/status`, { signal });
      if (!res.ok) return;
      const data = (await res.json()) as { items: StatusItem[] };
      const alarmed = (data.items ?? []).filter((i) => i.severity !== 'ok');
      if (!mountedRef.current) return;
      if (alarmed.length === 0) {
        setWorst(null);
        return;
      }
      const order: Record<Severity, number> = {
        blocked: 3,
        urgent: 2,
        soft: 1,
        ok: 0,
      };
      const top = alarmed.reduce((a, b) =>
        order[b.severity] > order[a.severity] ? b : a,
      );
      setWorst(top);
    } catch {
      // Ignore — banner is best-effort
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    check(ac.signal);
    const id = setInterval(() => check(ac.signal), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
      ac.abort();
    };
  }, [check]);

  if (!worst || worst.severity === 'ok') return null;

  const isBlocked = worst.severity === 'blocked';
  const isUrgent = worst.severity === 'urgent';

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b px-4 py-2 text-sm',
        isBlocked
          ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          : isUrgent
            ? 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400'
            : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
      )}
    >
      {isBlocked ? (
        <XCircle className="size-4 shrink-0" />
      ) : (
        <AlertTriangle className="size-4 shrink-0" />
      )}
      <span>
        {isBlocked
          ? t.settings.budgetBannerBlocked.replace('{name}', worst.policy.name)
          : t.settings.budgetBannerWarning
              .replace('{name}', worst.policy.name)
              .replace('{pct}', worst.percentUsed.toFixed(0))}
      </span>
      <span className="text-muted-foreground ml-auto text-xs">
        ${worst.currentSpend.toFixed(2)} / ${worst.policy.limit_usd.toFixed(2)}
      </span>
    </div>
  );
}
