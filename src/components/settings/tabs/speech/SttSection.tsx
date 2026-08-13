/**
 * SttSection
 *
 * STT provider/language settings, an in-page mic test (WebSocket streaming),
 * and the local Whisper model download badge.
 */

import { Mic } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../../components/Switch';
import type { SettingsTabProps } from '../../types';
import { useSpeechUpdate } from './hooks/useSpeechUpdate';
import { useSttTest } from './hooks/useSttTest';
import { LocalModelBadge } from './LocalModelBadge';
import { SectionHeader } from './SectionHeader';
import { SettingRow } from './SettingRow';
import { SttTestPanel } from './SttTestPanel';
import type { LocalModelStatus, TtsModelKey } from './types';

const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

interface SttSectionProps extends Pick<
  SettingsTabProps,
  'settings' | 'onSettingsChange'
> {
  localStatus: LocalModelStatus | null;
  onDownload: (model: 'stt' | TtsModelKey) => void;
}

export function SttSection({
  settings,
  onSettingsChange,
  localStatus,
  onDownload,
}: SttSectionProps) {
  const { t } = useLanguage();
  const s = t.settings;
  const speech = settings.speech;
  const updateSpeech = useSpeechUpdate(settings, onSettingsChange);

  const {
    sttTestState,
    sttTestTranscript,
    sttTestPartial,
    sttTestError,
    sttTestDuration,
    startSTTTest,
    stopSTTTest,
  } = useSttTest();

  return (
    <section className="space-y-4">
      <SectionHeader
        icon={<Mic size={16} className="text-muted-foreground" />}
        title={s.speechStt}
      />

      <SettingRow label={s.speechSttEnable} description={s.speechSttEnableDesc}>
        <Switch
          checked={speech.sttEnabled}
          onChange={(v) => updateSpeech({ sttEnabled: v })}
        />
      </SettingRow>

      <div
        className={`space-y-4 transition-opacity ${!speech.sttEnabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <div>
          <label className="text-foreground/80 mb-1 block text-sm font-medium">
            {s.speechSttProvider}
          </label>
          <select
            aria-label={s.speechSttProvider}
            value={speech.sttProvider}
            onChange={(e) => updateSpeech({ sttProvider: e.target.value })}
            className={INPUT_CLASS}
          >
            <option value="auto">{s.speechSttProviderAuto}</option>
            <option value="local">{s.speechSttProviderLocal}</option>
            {settings.providers.some(
              (p) => p.id === 'elevenlabs' && p.apiKey && p.enabled,
            ) && (
              <option value="elevenlabs">
                {s.speechSttProviderElevenLabs ?? 'ElevenLabs'}
              </option>
            )}
          </select>
        </div>

        <div>
          <label className="text-foreground/80 mb-1 block text-sm font-medium">
            {s.speechSttLanguage}
          </label>
          <input
            type="text"
            value={speech.sttLanguage}
            onChange={(e) => updateSpeech({ sttLanguage: e.target.value })}
            placeholder={s.speechSttLanguagePlaceholder}
            className={INPUT_CLASS}
            aria-label={s.speechSttLanguage}
          />
          <p className="text-muted-foreground mt-1 text-xs">
            {s.speechSttLanguageHint}
          </p>
        </div>

        <SettingRow
          label={s.speechSttStreaming}
          description={s.speechSttStreamingDesc}
        >
          <Switch
            checked={speech.sttStreaming}
            onChange={(v) => updateSpeech({ sttStreaming: v })}
          />
        </SettingRow>

        <SettingRow
          label="Voice activity detection"
          description="Automatically finalizes a streaming transcript when speech ends."
        >
          <Switch
            checked={speech.sttVadEnabled}
            onChange={(v) => updateSpeech({ sttVadEnabled: v })}
          />
        </SettingRow>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-foreground/80 mb-1 block text-sm font-medium">
              Push-to-talk key
            </label>
            <input
              type="text"
              value={speech.sttPttKey}
              onChange={(e) => updateSpeech({ sttPttKey: e.target.value })}
              placeholder="Space"
              className={INPUT_CLASS}
              aria-label="Push-to-talk key"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Uses KeyboardEvent.code, for example Space or AltLeft.
            </p>
          </div>

          <div>
            <label className="text-foreground/80 mb-1 block text-sm font-medium">
              Partial debounce
            </label>
            <input
              type="number"
              min={0}
              max={1000}
              value={speech.sttPartialDebounceMs}
              onChange={(e) =>
                updateSpeech({
                  sttPartialDebounceMs: Math.max(
                    0,
                    Math.min(1000, Number(e.target.value) || 0),
                  ),
                })
              }
              className={INPUT_CLASS}
              aria-label="Partial transcript debounce"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Milliseconds to smooth interim transcript updates.
            </p>
          </div>
        </div>

        <SttTestPanel
          sttTestState={sttTestState}
          sttTestTranscript={sttTestTranscript}
          sttTestPartial={sttTestPartial}
          sttTestError={sttTestError}
          sttTestDuration={sttTestDuration}
          onStart={startSTTTest}
          onStop={stopSTTTest}
        />

        {localStatus && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {s.speechLocalModels}
            </p>
            <LocalModelBadge
              model="stt"
              label={s.speechLocalSttLabel}
              status={localStatus.stt}
              onDownload={onDownload}
            />
          </div>
        )}
      </div>
    </section>
  );
}
