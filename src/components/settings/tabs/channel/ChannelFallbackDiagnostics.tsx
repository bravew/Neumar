import { useCallback, useEffect, useState } from 'react';

import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

interface FallbackDiagnostic {
  id: string;
  provider: string;
  operation?: string;
  errorClass: string;
  succeeded: boolean;
  createdAt: string;
}

interface DiagnosticsResponse {
  diagnostics?: FallbackDiagnostic[];
}

export function ChannelFallbackDiagnostics() {
  const { t } = useLanguage();
  const s = t.settings;
  const [diagnostics, setDiagnostics] = useState<FallbackDiagnostic[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/channels/fallback-diagnostics`,
        { signal },
      );
      if (!response.ok) return;
      const body = (await response.json()) as DiagnosticsResponse;
      setDiagnostics(body.diagnostics ?? []);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <section className="border-border rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          {s.channelFallbackDiagnosticsTitle}
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label={s.channelFallbackDiagnosticsRefresh}
        >
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          <span>{s.channelFallbackDiagnosticsRefresh}</span>
        </Button>
      </div>

      {diagnostics.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {s.channelFallbackDiagnosticsEmpty}
        </p>
      ) : (
        <div className="divide-border divide-y">
          {diagnostics.slice(-5).map((item) => (
            <div
              key={item.id}
              className="grid gap-2 py-2 text-sm sm:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {item.provider}
                  {item.operation ? ` / ${item.operation}` : ''}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {item.errorClass}
                </div>
              </div>
              <div className="text-muted-foreground text-xs">
                {item.succeeded
                  ? s.channelFallbackDiagnosticsSucceeded
                  : s.channelFallbackDiagnosticsFailed}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
