import { AlertTriangle, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

interface ConnectorAuthErrorBannerProps {
  error: string;
  onDismiss: () => void;
  onRetry: () => void;
}

export function ConnectorAuthErrorBanner({
  error,
  onDismiss,
  onRetry,
}: ConnectorAuthErrorBannerProps) {
  const { t } = useLanguage();
  return (
    <div className="border-destructive/25 bg-destructive/10 text-destructive flex items-start gap-3 rounded-lg border px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t.settings.connectorAuthError}</p>
        <p className="mt-1 text-xs break-words">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-xs font-medium underline underline-offset-2"
        >
          {t.task.retry}
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-1"
        aria-label={t.settings.connectorAuthErrorDismiss}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
