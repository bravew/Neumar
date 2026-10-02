import type { MediaConfig } from '@/shared/db/settings';
import { isProviderReady } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  customProviderModels,
  providerDefaultModels,
  providerIcons,
  providerSvgIcons,
} from '../constants';
import type { AIProvider } from '../types';

const MEDIA_SELECT_CLASS =
  'border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-md rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none';

type MediaProviderKey = 'defaultImageProvider' | 'defaultVideoProvider';

export function MediaProviderSettings({
  media,
  onChange,
}: {
  media: MediaConfig;
  onChange: (next: MediaConfig) => void;
}) {
  const { t } = useLanguage();
  const autoLabel = t.settings.mediaProviderAuto;

  // Brand and model identifiers stay in English; only the descriptor is localized.
  const imageOptions = [
    { value: 'auto', label: autoLabel },
    { value: 'codex', label: 'Codex CLI (local · gpt-image-2)' },
    { value: 'byteplus', label: 'BytePlus (Seedream)' },
    { value: 'openai', label: 'OpenAI (DALL-E / gpt-image)' },
    { value: 'gemini', label: 'Google Gemini (Imagen)' },
  ];
  const videoOptions = [
    { value: 'auto', label: autoLabel },
    { value: 'byteplus', label: 'BytePlus (Seedance)' },
    { value: 'openai', label: 'OpenAI (Sora)' },
    { value: 'gemini', label: 'Google Gemini (Veo)' },
  ];
  const rows: Array<{
    key: MediaProviderKey;
    label: string;
    options: Array<{ value: string; label: string }>;
  }> = [
    {
      key: 'defaultImageProvider',
      label: t.settings.defaultImageProvider,
      options: imageOptions,
    },
    {
      key: 'defaultVideoProvider',
      label: t.settings.defaultVideoProvider,
      options: videoOptions,
    },
  ];

  return (
    <div className="space-y-4">
      <h4 className="text-foreground text-sm font-medium">
        {t.settings.mediaGeneration}
      </h4>
      <p className="text-muted-foreground text-xs">
        {t.settings.mediaGenerationDescription}
      </p>
      {rows.map(({ key, label, options }) => {
        const selectId = `media-${key}`;
        return (
          <div key={key} className="flex flex-col gap-2">
            <label
              htmlFor={selectId}
              className="text-foreground block text-sm font-medium"
            >
              {label}
            </label>
            <select
              id={selectId}
              value={media[key] || 'auto'}
              onChange={(e) => onChange({ ...media, [key]: e.target.value })}
              className={MEDIA_SELECT_CLASS}
            >
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

// Get suggested models for a provider
export function getSuggestedModels(provider: AIProvider): string[] {
  // First check by provider ID
  if (providerDefaultModels[provider.id]) {
    return providerDefaultModels[provider.id];
  }

  // Then check custom provider models by name (case-insensitive)
  const providerNameLower = provider.name.toLowerCase();
  for (const [key, models] of Object.entries(customProviderModels)) {
    if (providerNameLower.includes(key.toLowerCase())) {
      return models;
    }
  }

  // Fall back to default
  return providerDefaultModels.default || [];
}

// ============================================================================
// Provider Button
// ============================================================================

export function ProviderButton({
  provider,
  active,
  onClick,
}: {
  provider: AIProvider;
  active: boolean;
  onClick: () => void;
}) {
  const ready = isProviderReady(provider);
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <span className="bg-muted text-muted-foreground relative flex size-6 items-center justify-center rounded p-1 text-xs font-medium">
        {providerSvgIcons[provider.id] ||
          providerIcons[provider.id] ||
          provider.name.charAt(0).toUpperCase()}
        {provider.enabled && ready && (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500" />
        )}
      </span>
      <span className="flex-1 text-left">{provider.name}</span>
    </button>
  );
}
