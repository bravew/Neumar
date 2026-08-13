import { useCallback, useEffect, useState } from 'react';

import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Sparkles, X } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import type { useLanguage } from '@/shared/providers/language-provider';

interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  locales: string[];
}

interface SoulTemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  language: string;
  onApplied: () => void;
  t: ReturnType<typeof useLanguage>['t'];
}

export function SoulTemplatePicker({
  open,
  onOpenChange,
  profileId,
  language,
  onApplied,
  t,
}: SoulTemplatePickerProps) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(
      `${API_BASE_URL}/soul/templates?language=${encodeURIComponent(language)}`,
      {
        signal: controller.signal,
      },
    )
      .then((r) => r.json())
      .then((data) => setTemplates(data as TemplateSummary[]))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, language]);

  const applyTemplate = useCallback(
    async (templateId: string) => {
      setApplying(templateId);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}/soul/agent-profiles/${profileId}/apply`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: templateId, language }),
          },
        );
        if (res.ok) {
          onApplied();
          onOpenChange(false);
        } else {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(data?.error ?? 'Failed to apply template');
        }
      } catch {
        setError('Network error');
      } finally {
        setApplying(null);
      }
    },
    [profileId, language, onApplied, onOpenChange],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="bg-background border-border fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border p-5 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-foreground text-base font-semibold">
              {t.profiles.soulTemplates}
            </Dialog.Title>
            <Dialog.Close
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {error && (
            <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            </div>
          ) : (
            <div className="grid gap-3">
              {templates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => applyTemplate(tmpl.id)}
                  disabled={applying !== null}
                  aria-label={`${t.profiles.soulApplyTemplate}: ${tmpl.name}`}
                  className={cn(
                    'border-border hover:border-primary/40 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    applying === tmpl.id && 'border-primary/60 bg-primary/5',
                  )}
                >
                  <Sparkles className="text-primary mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground text-sm font-medium">
                      {tmpl.name}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {tmpl.description}
                    </div>
                  </div>
                  {applying === tmpl.id && (
                    <Loader2 className="text-primary size-4 animate-spin" />
                  )}
                </button>
              ))}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
