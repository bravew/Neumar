import { useEffect, useMemo, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

interface VoiceInfo {
  id: string;
  name: string;
  language?: string;
  category?: string;
  previewUrl?: string;
}

export function AudioProviderControls({
  model,
  voice,
  onVoiceChange,
}: {
  model?: string;
  voice?: string;
  onVoiceChange: (voice: string | undefined) => void;
}) {
  const { t } = useLanguage();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (model !== 'elevenlabs-speech') {
      setVoices([]);
      setState('idle');
      return;
    }
    const ac = new AbortController();
    setState('loading');
    fetch(`${API_BASE_URL}/design/media/voices?provider=elevenlabs`, {
      signal: ac.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as { voices: VoiceInfo[] };
      })
      .then((data) => {
        setVoices(data.voices);
        setState('idle');
      })
      .catch((error) => {
        if ((error as Error).name === 'AbortError') return;
        setVoices([]);
        setState('error');
      });
    return () => ac.abort();
  }, [model]);

  const groups = useMemo(() => {
    const grouped = new Map<string, VoiceInfo[]>();
    for (const item of voices) {
      const language = item.language || 'multi';
      grouped.set(language, [...(grouped.get(language) ?? []), item]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [voices]);

  if (model !== 'elevenlabs-speech') return null;

  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{t.design.voicePickerLabel}</span>
      <select
        value={voice ?? ''}
        disabled={state === 'loading' || voices.length === 0}
        onChange={(event) => onVoiceChange(event.target.value || undefined)}
        className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
      >
        <option value="">
          {state === 'loading'
            ? t.design.voicePickerLoading
            : state === 'error'
              ? t.design.voicePickerProviderMissing
              : t.design.voicePickerEmpty}
        </option>
        {groups.map(([language, items]) => (
          <optgroup key={language} label={language}>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
