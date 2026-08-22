import { useState } from 'react';

import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoEngineOption } from '@/shared/video/useVideoEngines';

import { engineSetupStep } from './engineSetupGuidance';

interface EngineSetupPromptProps {
  engine: VideoEngineOption;
  onRecheck?: () => void;
}

/**
 * Doctor-style first-run surface for an engine that cannot run on this host.
 * Turns `probeAvailability()`'s typed reason into one copyable command plus a
 * re-check, instead of letting the user meet the reason as a render failure.
 */
export function EngineSetupPrompt({
  engine,
  onRecheck,
}: EngineSetupPromptProps) {
  const { t } = useLanguage();
  const s = t.video.engines.setup;
  const [copied, setCopied] = useState(false);
  const step = engineSetupStep(engine);

  if (engine.installed) return null;

  const reasonText = (
    engine.unavailableReason === 'version-too-old'
      ? s.reasonVersionTooOld
          .replace('{engine}', engine.name)
          .replace('{found}', engine.detectedVersion ?? s.unknownVersion)
          .replace('{required}', engine.requiredVersion ?? engine.version)
      : engine.unavailableReason === 'browser-missing'
        ? s.reasonBrowserMissing.replace('{engine}', engine.name)
        : s.reasonNotFound.replace('{engine}', engine.name)
  ) as string;

  const copy = () => {
    if (!step) return;
    void navigator.clipboard
      .writeText(step.command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div
      className="border-border bg-muted/40 space-y-2 rounded-md border px-3 py-2"
      data-testid={`engine-setup-${engine.id}`}
      role="status"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-foreground text-xs font-medium">
            {s.title.replace('{engine}', engine.name)}
          </p>
          <p className="text-muted-foreground text-[11px]">{reasonText}</p>
          {engine.detail ? (
            <p className="text-muted-foreground truncate text-[11px] opacity-80">
              {engine.detail}
            </p>
          ) : null}
          <p className="text-muted-foreground text-[11px]">
            {s.noSubstitution}
          </p>
        </div>
      </div>

      {step ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-background border-border min-w-0 flex-1 truncate rounded border px-2 py-1 font-mono text-[11px]">
            {step.command}
          </code>
          <button
            type="button"
            onClick={copy}
            className="border-border text-foreground hover:bg-muted inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
            aria-label={s.copyCommand}
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? s.copied : s.copyCommand}
          </button>
          {step.docsUrl ? (
            <a
              href={step.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] underline"
            >
              <ExternalLink className="size-3" />
              {s.docs}
            </a>
          ) : null}
        </div>
      ) : null}

      {onRecheck ? (
        <button
          type="button"
          onClick={onRecheck}
          className="border-border text-foreground hover:bg-muted inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
        >
          <RefreshCw className="size-3" />
          {s.recheck}
        </button>
      ) : null}
    </div>
  );
}
