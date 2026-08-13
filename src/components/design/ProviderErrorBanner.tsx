import { AlertTriangle } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

export function ProviderErrorBanner({ message }: { message?: string | null }) {
  const { t } = useLanguage();
  if (!message) return null;
  return (
    <div className="border-destructive/40 bg-destructive/10 text-destructive flex gap-2 rounded-md border p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        {t.design.warnPrefix}: {message}
      </span>
    </div>
  );
}
