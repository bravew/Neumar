import { useId, type ComponentType } from 'react';

import {
  FileUp,
  FolderOpen,
  Image,
  LayoutTemplate,
  Music,
  Palette,
  Video,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  CREATIVE_INTENTS,
  type CreativeIntentId,
} from '@/shared/creative-workflow';
import { recordCreativeDebugCounter } from '@/shared/creative-workflow/debug-counters';
import { cn } from '@/shared/lib/utils';

interface CreativeIntentEntryLabels {
  title: string;
  promptLabel: string;
  promptPlaceholder: string;
  startFailed: string;
  start: string;
  disabledIntentReason: string;
  intent: Record<CreativeIntentId, string>;
}

interface CreativeIntentEntryProps {
  labels: CreativeIntentEntryLabels;
  selectedIntent: CreativeIntentId;
  prompt: string;
  onSelectIntent: (intent: CreativeIntentId) => void;
  onPromptChange: (prompt: string) => void;
  onStart: () => void;
  disabledIntents?: Partial<Record<CreativeIntentId, boolean>>;
  disabledIntentReasons?: Partial<Record<CreativeIntentId, string>>;
  startDisabled?: boolean;
}

const INTENT_ICONS = {
  design: Palette,
  video: Video,
  image: Image,
  audio: Music,
  assets: FolderOpen,
  template: LayoutTemplate,
  import: FileUp,
} satisfies Record<CreativeIntentId, ComponentType<{ className?: string }>>;

export function CreativeIntentEntry({
  labels,
  selectedIntent,
  prompt,
  onSelectIntent,
  onPromptChange,
  onStart,
  disabledIntents,
  disabledIntentReasons,
  startDisabled = false,
}: CreativeIntentEntryProps) {
  const groupName = useId();

  return (
    <section className="border-border bg-background rounded-lg border p-3">
      <fieldset className="space-y-3">
        <legend className="text-foreground text-sm font-semibold">
          {labels.title}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CREATIVE_INTENTS.map((intent) => {
            const Icon = INTENT_ICONS[intent];
            const active = selectedIntent === intent;
            const disabled = disabledIntents?.[intent] ?? false;
            const disabledReason = disabled
              ? (disabledIntentReasons?.[intent] ?? labels.disabledIntentReason)
              : undefined;
            const disabledReasonId = disabledReason
              ? `${groupName}-${intent}-disabled-reason`
              : undefined;
            return (
              <label
                key={intent}
                className={cn('block', disabled && 'cursor-not-allowed')}
                title={disabledReason}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={intent}
                  checked={active}
                  disabled={disabled}
                  aria-label={labels.intent[intent]}
                  aria-describedby={disabledReasonId}
                  onChange={() => {
                    recordCreativeDebugCounter('entry.intent.selected');
                    onSelectIntent(intent);
                  }}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    'border-input bg-background hover:bg-accent peer-focus-visible:ring-ring/50 flex min-h-10 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors peer-focus-visible:ring-2',
                    active &&
                      'border-primary bg-primary/10 text-primary hover:bg-primary/10',
                    disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="min-w-0 truncate">
                    {labels.intent[intent]}
                  </span>
                </span>
                {disabledReason ? (
                  <span id={disabledReasonId} className="sr-only">
                    {disabledReason}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">{labels.promptLabel}</span>
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={labels.promptPlaceholder}
            className="border-input bg-background focus:ring-ring/40 min-h-20 w-full resize-none rounded-md border p-3 text-sm outline-none focus:ring-2"
          />
        </label>
        <Button
          type="button"
          className="w-full"
          onClick={onStart}
          disabled={startDisabled}
        >
          {labels.start}
        </Button>
      </fieldset>
    </section>
  );
}
