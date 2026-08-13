import { useMemo, useState } from 'react';

import * as Popover from '@radix-ui/react-popover';
import {
  BadgeCheck,
  Check,
  ChevronsUpDown,
  CircleDashed,
  Lock,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const MODELS = [
  {
    provider: 'OpenAI',
    state: 'Integrated',
    models: [
      { id: 'gpt-image-2', surfaces: ['image'] },
      { id: 'gpt-4o-mini-tts', surfaces: ['audio'] },
    ],
  },
  {
    provider: 'BytePlus',
    state: 'Integrated',
    models: [
      { id: 'seedream-5.0', surfaces: ['image'] },
      { id: 'seedance-2.0', surfaces: ['video'] },
    ],
  },
  {
    provider: 'Leonardo.ai',
    state: 'Integrated',
    models: [
      { id: 'leonardo-phoenix', surfaces: ['image'] },
      { id: 'leonardo-kino-xl', surfaces: ['image'] },
      { id: 'leonardo-flux-dev', surfaces: ['image'] },
      { id: 'leonardo-flux-schnell', surfaces: ['image'] },
      { id: 'leonardo-anime-pastel', surfaces: ['image'] },
    ],
  },
  {
    provider: 'ImageRouter',
    state: 'Integrated',
    models: [
      { id: 'imagerouter:image', surfaces: ['image'] },
      { id: 'imagerouter:video', surfaces: ['video'] },
    ],
  },
  {
    provider: 'Custom image',
    state: 'Configured',
    models: [{ id: 'custom-image:default', surfaces: ['image'] }],
  },
  {
    provider: 'ElevenLabs',
    state: 'Integrated',
    models: [
      { id: 'elevenlabs-speech', surfaces: ['audio'] },
      { id: 'elevenlabs-sfx', surfaces: ['audio'] },
    ],
  },
  {
    provider: 'SenseAudio',
    state: 'Integrated',
    models: [{ id: 'senseaudio-tts', surfaces: ['audio'] }],
  },
  {
    provider: 'HyperFrames',
    state: 'Unsupported',
    models: [{ id: 'hyperframes-html', surfaces: ['video'] }],
  },
];

export function MediaModelCards({
  value,
  surface,
  aliases,
  onChange,
}: {
  value?: string;
  surface?: 'image' | 'video' | 'audio';
  aliases?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const selected = MODELS.flatMap((group) =>
    group.models.map((model) => ({
      model: model.id,
      provider: group.provider,
    })),
  ).find((item) => item.model === value);
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return MODELS.map((group) => ({
      ...group,
      models: group.models.filter(
        (model) =>
          (!surface || model.surfaces.includes(surface)) &&
          (model.id.toLowerCase().includes(q) ||
            group.provider.toLowerCase().includes(q)),
      ),
    })).filter((group) => group.models.length > 0);
  }, [query, surface]);
  const selectedAlias = value ? aliases?.[value] : undefined;
  const triggerText = selected
    ? `${selected.provider} · ${selected.model}${
        selectedAlias ? ` -> ${selectedAlias}` : ''
      }`
    : t.design.modelPickerPlaceholder;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${t.design.modelPickerLabel}: ${triggerText}`}
          className="border-input bg-background flex h-10 w-full items-center justify-between rounded-md border px-3 text-left text-sm"
        >
          <span>{triggerText}</span>
          <ChevronsUpDown className="text-muted-foreground size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        sideOffset={6}
        className="bg-popover z-50 w-[var(--radix-popover-trigger-width)] rounded-md border p-2 shadow-md"
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t.design.modelPickerSearchLabel}
          placeholder={t.design.modelPickerSearch}
          className="border-input mb-2 h-9 w-full rounded-md border px-2 text-sm"
        />
        <div className="max-h-64 space-y-2 overflow-auto">
          {filtered.map((group) => {
            const StateIcon =
              group.state === 'Configured'
                ? BadgeCheck
                : group.state === 'Integrated'
                  ? CircleDashed
                  : Lock;
            return (
              <section key={group.provider} className="space-y-1">
                <div className="design-media-model-provider-header text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
                  <StateIcon className="size-3.5" />
                  {group.provider}
                </div>
                {group.models.map((model, index) => (
                  <Popover.Close key={model.id} asChild>
                    <button
                      type="button"
                      className={cn(
                        'hover:bg-accent flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm disabled:opacity-50',
                        value === model.id && 'bg-accent',
                      )}
                      onClick={() => onChange(model.id)}
                      disabled={group.state === 'Unsupported'}
                    >
                      <span>
                        <span className="block font-medium">{model.id}</span>
                        {aliases?.[model.id] && (
                          <span className="text-muted-foreground block text-xs">
                            {t.design.modelAliasResolved.replace(
                              '{model}',
                              aliases[model.id],
                            )}
                          </span>
                        )}
                        {index === 0 && (
                          <span className="text-primary text-xs">
                            {t.design.modelRecommended}
                          </span>
                        )}
                      </span>
                      {value === model.id && <Check className="size-4" />}
                    </button>
                  </Popover.Close>
                ))}
              </section>
            );
          })}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
