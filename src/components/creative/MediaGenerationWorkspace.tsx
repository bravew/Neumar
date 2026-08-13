import { useEffect, type ReactNode } from 'react';

import { X } from 'lucide-react';

import type { MediaGenerationSurface } from '@/shared/creative-workflow';
import { recordCreativeDebugCounterOnce } from '@/shared/creative-workflow/debug-counters';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export interface MediaGenerationReference {
  id: string;
  name: string;
  summary?: string;
}

export interface MediaGenerationCapability {
  id: string;
  label: string;
  value: string;
}

interface MediaGenerationWorkspaceProps {
  surface: MediaGenerationSurface;
  prompt?: string;
  promptLabel?: string;
  promptPlaceholder?: string;
  promptTestId?: string;
  onPromptChange?: (prompt: string) => void;
  title?: string;
  description?: string;
  capabilities?: readonly MediaGenerationCapability[];
  references?: readonly MediaGenerationReference[];
  onRemoveReference?: (referenceId: string) => void;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function MediaGenerationWorkspace({
  surface,
  prompt = '',
  promptLabel,
  promptPlaceholder,
  promptTestId,
  onPromptChange,
  title,
  description,
  capabilities = [],
  references = [],
  onRemoveReference,
  children,
  footer,
  className,
}: MediaGenerationWorkspaceProps) {
  const { t } = useLanguage();
  const labels = t.creative.mediaGeneration;
  const resolvedPromptLabel = promptLabel ?? labels.prompt;

  useEffect(() => {
    recordCreativeDebugCounterOnce(
      'generate.panel.opened',
      `media-generation:${surface}`,
    );
  }, [surface]);

  return (
    <section
      aria-label={labels.label}
      data-testid="media-generation-workspace"
      className={cn(
        'border-border bg-card/40 space-y-3 rounded-md border p-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-foreground text-sm font-semibold">
            {title ?? labels.title}
          </h3>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {description}
            </p>
          ) : null}
        </div>
        <span className="border-border bg-background text-muted-foreground rounded-md border px-2 py-1 text-xs">
          {t.creative.generationSurface[surface]}
        </span>
      </div>

      {capabilities.length > 0 ? (
        <dl className="grid gap-2 md:grid-cols-3">
          {capabilities.map((capability) => (
            <div
              key={capability.id}
              className="bg-background/70 rounded-md border px-2 py-1.5"
            >
              <dt className="text-muted-foreground text-[11px]">
                {capability.label}
              </dt>
              <dd className="text-foreground truncate text-xs font-medium">
                {capability.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {references.length > 0 ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">
            {labels.references}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {references.map((reference) => (
              <li
                key={reference.id}
                className="border-primary/30 bg-primary/10 text-foreground flex max-w-[220px] items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
                title={
                  reference.summary
                    ? `${reference.name} - ${reference.summary}`
                    : reference.name
                }
              >
                <span className="truncate">{reference.name}</span>
                {onRemoveReference ? (
                  <button
                    type="button"
                    aria-label={labels.removeReference.replace(
                      '{name}',
                      reference.name,
                    )}
                    onClick={() => onRemoveReference(reference.id)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {onPromptChange ? (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">{resolvedPromptLabel}</span>
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={promptPlaceholder}
            data-testid={promptTestId}
            className="border-input bg-background focus:ring-ring/40 min-h-24 w-full resize-none rounded-md border p-3 outline-none focus:ring-2"
          />
        </label>
      ) : null}

      {children ? (
        <div className="space-y-3" role="group" aria-label={labels.settings}>
          {children}
        </div>
      ) : null}

      {footer}
    </section>
  );
}
