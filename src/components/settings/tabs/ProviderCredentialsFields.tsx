import { useEffect, useRef, useState } from 'react';

import { AlertCircle, Check, ExternalLink, Loader2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { ApiKeyField } from '../components/ApiKeyField';
import { providerApiKeyUrls } from '../constants';
import type { AIProvider } from '../types';
import { openExternalUrl } from './provider-detail-utils';

// Debounce before a credential edit triggers a draft validation. Long enough
// that typing a key/URL does not fire a request per keystroke.
const VALIDATE_DEBOUNCE_MS = 800;
// Upper bound on a single validation request so a hung /providers/test never
// leaves the badge stuck on "Validating…" (matches the sibling Test button).
const VALIDATE_TIMEOUT_MS = 15_000;

type ValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid';

interface DraftTestResult {
  success: boolean;
  latencyMs: number;
  message: string;
}

interface ProviderCredentialsFieldsProps {
  provider: AIProvider;
  /** Model used for the draft validation request (first concrete model). */
  validationModel?: string;
  onApiKeyChange: (key: string) => void;
  onBaseUrlChange: (baseUrl: string) => void;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Renders the API key + base URL credential fields with debounced, in-field
 * draft validation. After a user edits either field, the credentials are tested
 * against `POST /providers/test` and an inline pass/fail badge is shown — the
 * neumar-fit form of upstream's "validate before save" (`#3506`/`#3484`), since
 * provider edits auto-persist here rather than gating an explicit Save button.
 */
export function ProviderCredentialsFields({
  provider,
  validationModel,
  onApiKeyChange,
  onBaseUrlChange,
}: ProviderCredentialsFieldsProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ValidationStatus>('idle');
  const [message, setMessage] = useState('');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // Only validate after the user actually edits a field — never auto-fire on
  // mount for already-saved providers (avoids hammering /providers/test on open).
  const touchedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const requiresApiKey = provider.category !== 'local';
  const apiKey = provider.apiKey;
  const baseUrl = provider.baseUrl;
  const agentType = provider.agentType;
  const dialect = provider.dialect;

  useEffect(() => {
    if (!touchedRef.current) return;

    if (!validationModel || !isValidHttpUrl(baseUrl)) {
      setStatus('idle');
      return;
    }
    if (requiresApiKey && !apiKey.trim()) {
      setStatus('idle');
      return;
    }

    setStatus('validating');
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, VALIDATE_TIMEOUT_MS);
      try {
        const response = await fetch(`${API_BASE_URL}/providers/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            baseUrl,
            model: validationModel,
            agentType,
            providerId: provider.id,
            dialect,
          }),
          signal: controller.signal,
        });
        const result = (await response.json()) as DraftTestResult;
        setStatus(result.success ? 'valid' : 'invalid');
        setMessage(result.message);
        setLatencyMs(result.latencyMs ?? null);
      } catch (error) {
        // A newer edit / unmount aborts the request — stay silent. A timeout
        // abort still surfaces as a failed validation.
        if ((error as Error).name === 'AbortError' && !timedOut) return;
        setStatus('invalid');
        setMessage(
          !timedOut && error instanceof Error
            ? error.message
            : t.settings.connectionFailed,
        );
        setLatencyMs(null);
      } finally {
        clearTimeout(timeoutId);
      }
    }, VALIDATE_DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
      abortRef.current?.abort();
    };
  }, [
    apiKey,
    baseUrl,
    validationModel,
    agentType,
    dialect,
    provider.id,
    requiresApiKey,
    t,
  ]);

  return (
    <>
      {/* API Key */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.apiKey}
        </label>
        <ApiKeyField
          value={apiKey}
          onChange={(newKey) => {
            touchedRef.current = true;
            onApiKeyChange(newKey);
          }}
          placeholder={t.settings.enterApiKey}
        />
        {providerApiKeyUrls[provider.id] && (
          <button
            onClick={() => openExternalUrl(providerApiKeyUrls[provider.id])}
            className="text-primary hover:text-primary/80 inline-flex cursor-pointer items-center gap-1 text-xs"
          >
            {t.settings.getApiKey}
            <ExternalLink className="size-3" />
          </button>
        )}
      </div>

      {/* API Base URL */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.apiBaseUrl}
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => {
            touchedRef.current = true;
            onBaseUrlChange(e.target.value);
          }}
          placeholder={t.settings.apiBaseUrl}
          className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
        />
        {status !== 'idle' && (
          <CredentialValidationBadge
            status={status}
            message={message}
            latencyMs={latencyMs}
            validatingLabel={t.settings.validatingCredentials}
            validLabel={t.settings.credentialsValid}
            invalidLabel={t.settings.credentialsInvalid}
          />
        )}
      </div>
    </>
  );
}

function CredentialValidationBadge({
  status,
  message,
  latencyMs,
  validatingLabel,
  validLabel,
  invalidLabel,
}: {
  status: ValidationStatus;
  message: string;
  latencyMs: number | null;
  validatingLabel: string;
  validLabel: string;
  invalidLabel: string;
}) {
  if (status === 'validating') {
    return (
      <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {validatingLabel}
      </p>
    );
  }
  if (status === 'valid') {
    return (
      <p
        className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
        role="status"
      >
        <Check className="size-3.5" />
        {latencyMs != null ? `${validLabel} (${latencyMs}ms)` : validLabel}
      </p>
    );
  }
  return (
    <p
      className={cn(
        'text-destructive inline-flex items-center gap-1.5 text-xs',
      )}
      role="alert"
    >
      <AlertCircle className="size-3.5 shrink-0" />
      <span>{message || invalidLabel}</span>
    </p>
  );
}
