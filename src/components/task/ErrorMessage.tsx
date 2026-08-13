import { useCallback, useMemo, useState } from 'react';

import { Link } from 'react-router-dom';

import { APP_DATA_DIR, APP_SLUG } from '@/config/branding';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { SettingsModal } from '../settings/SettingsModal';

// Reusable status icon — avoids duplicating the same SVG in every error variant
export function StatusIcon({ variant }: { variant: 'warning' | 'error' }) {
  const colorClass =
    variant === 'warning' ? 'text-amber-500' : 'text-destructive';
  return (
    <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
      <svg
        viewBox="0 0 16 16"
        className={cn('size-4', colorClass)}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
      </svg>
    </div>
  );
}

// Shared layout for errors that link to the Settings modal
export function ActionableError({
  text,
  linkText,
  onOpenSettings,
}: {
  text: string;
  linkText: string;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-sm">{text}</p>
      <button
        onClick={onOpenSettings}
        className="text-primary hover:text-primary/80 cursor-pointer text-left text-sm underline underline-offset-2"
      >
        {linkText}
      </button>
    </div>
  );
}

/** Regex to detect API key / authentication errors in error messages */
const API_KEY_ERROR_PATTERN =
  /invalid api key|api key|authentication|unauthorized|please run \/login/i;

// Error Message Component with API key detection
export function ErrorMessage({
  message,
  subtype,
}: {
  message: string | undefined;
  subtype?: string;
}) {
  const { t } = useLanguage();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Fallback to i18n-localized "Unknown error" when the caller passes an
  // empty or nullish message (e.g. an error row persisted without content).
  const resolvedMessage = message || t.task.agentUnknownError;

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  // Map well-known error markers to { text, linkText } — memoized so the
  // object is only recreated when translations change, not on every render.
  const knownErrors = useMemo<
    Record<string, { text: string; linkText: string }>
  >(
    () => ({
      __MODEL_NOT_CONFIGURED__: {
        text: t.common.errors.modelNotConfigured,
        linkText: t.common.errors.configureModel,
      },
      __CLAUDE_CODE_NOT_FOUND__: {
        text: t.common.errors.claudeCodeNotFound,
        linkText: t.common.errors.configureModel,
      },
      __API_KEY_ERROR__: {
        text: t.common.errors.apiKeyError,
        linkText: t.common.errors.configureApiKey,
      },
    }),
    [t],
  );

  // 0. Context overflow error — show actionable buttons
  if (subtype === 'context_length_exceeded') {
    let model = 'unknown';
    try {
      const payload = JSON.parse(resolvedMessage);
      model = payload.model || model;
    } catch {
      // message may not be JSON — use raw text
    }
    const overflowText = (
      t.common.errors.contextOverflow ||
      'Context window limit reached for {model}.'
    ).replace('{model}', model);

    return (
      <>
        <div className="flex items-start gap-3 py-2">
          <StatusIcon variant="warning" />
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">{overflowText}</p>
            <div className="flex gap-2">
              <Link
                to="/"
                className="text-primary hover:text-primary/80 text-sm underline underline-offset-2"
              >
                {t.common.errors.contextOverflowNewSession ||
                  'Start New Session'}
              </Link>
              <button
                onClick={openSettings}
                className="text-primary hover:text-primary/80 cursor-pointer text-sm underline underline-offset-2"
              >
                {t.common.errors.contextOverflowSwitchModel || 'Switch Model'}
              </button>
            </div>
          </div>
        </div>
        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialCategory="model"
        />
      </>
    );
  }

  // 1. Check known error markers
  const known = knownErrors[resolvedMessage];
  if (known) {
    return (
      <>
        <div className="flex items-start gap-3 py-2">
          <StatusIcon variant="warning" />
          <ActionableError
            text={known.text}
            linkText={known.linkText}
            onOpenSettings={openSettings}
          />
        </div>
        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialCategory="model"
        />
      </>
    );
  }

  // 2. Custom API error (format: __CUSTOM_API_ERROR__|baseUrl|logPath)
  if (resolvedMessage.startsWith('__CUSTOM_API_ERROR__|')) {
    const parts = resolvedMessage.split('|');
    const baseUrl = parts[1] || '';
    const logPath = parts[2] || `~/${APP_DATA_DIR}/logs/${APP_SLUG}.log`;
    const errorMessage = (
      t.common.errors.customApiError ||
      'Custom API ({baseUrl}) may not be compatible with Claude Code SDK. Please check the API configuration or try a different provider. Log file: {logPath}'
    )
      .replace('{baseUrl}', baseUrl)
      .replace('{logPath}', logPath);

    return (
      <div className="flex items-start gap-3 py-2">
        <StatusIcon variant="warning" />
        <p className="text-muted-foreground text-sm">{errorMessage}</p>
      </div>
    );
  }

  // 3. Internal error (format: __INTERNAL_ERROR__|logPath)
  if (resolvedMessage.startsWith('__INTERNAL_ERROR__|')) {
    const logPath =
      resolvedMessage.split('|')[1] || `~/${APP_DATA_DIR}/logs/${APP_SLUG}.log`;
    const errorMessage = (
      t.common.errors.internalError ||
      'Internal server error. Please check log file: {logPath}'
    ).replace('{logPath}', logPath);

    return (
      <div className="flex items-start gap-3 py-2">
        <StatusIcon variant="error" />
        <p className="text-muted-foreground text-sm">{errorMessage}</p>
      </div>
    );
  }

  // 4. Fallback: regex-based API key error detection
  if (API_KEY_ERROR_PATTERN.test(resolvedMessage)) {
    return (
      <>
        <div className="flex items-start gap-3 py-2">
          <StatusIcon variant="warning" />
          <ActionableError
            text={t.common.errors.apiKeyError}
            linkText={t.common.errors.configureApiKey}
            onOpenSettings={openSettings}
          />
        </div>
        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialCategory="model"
        />
      </>
    );
  }

  // 5. Generic error fallback
  return (
    <div className="flex items-start gap-3 py-2" role="alert">
      <StatusIcon variant="error" />
      <p className="text-muted-foreground text-sm">{resolvedMessage}</p>
    </div>
  );
}
