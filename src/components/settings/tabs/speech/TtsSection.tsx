/**
 * TtsSection
 *
 * TTS provider/voice/speed settings, an in-page synthesis test, local model
 * download badges, and the voice cloning panel (upload or mic record).
 */

import { useEffect, useMemo, useState } from 'react';

import { Volume2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../../components/Switch';
import type { SettingsTabProps } from '../../types';
import { useSpeechUpdate } from './hooks/useSpeechUpdate';
import { useTtsTest } from './hooks/useTtsTest';
import { useVoiceCloning } from './hooks/useVoiceCloning';
import { LocalModelBadge } from './LocalModelBadge';
import { RangeSlider } from './RangeSlider';
import { SectionHeader } from './SectionHeader';
import { SettingRow } from './SettingRow';
import { TtsTestPanel } from './TtsTestPanel';
import type { LocalModelStatus, TtsModelKey, Voice } from './types';
import { formatVoiceLabel, resolveLanguageLabel } from './voice-utils';
import { VoiceCloningPanel } from './VoiceCloningPanel';

const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

interface TtsSectionProps extends Pick<
  SettingsTabProps,
  'settings' | 'onSettingsChange'
> {
  localStatus: LocalModelStatus | null;
  onDownload: (model: 'stt' | TtsModelKey) => void;
}

export function TtsSection({
  settings,
  onSettingsChange,
  localStatus,
  onDownload,
}: TtsSectionProps) {
  const { t, tt } = useLanguage();
  const s = t.settings;
  const speech = settings.speech;
  const updateSpeech = useSpeechUpdate(settings, onSettingsChange);

  // ── Voices ──────────────────────────────────────────────────────────────────
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesFetchError, setVoicesFetchError] = useState(false);

  // Re-fetch voices when speech-relevant providers change (e.g. ElevenLabs key added)
  const speechProviderKey = useMemo(
    () =>
      settings.providers
        .filter(
          (p) => p.id === 'elevenlabs' || p.baseUrl?.includes('elevenlabs'),
        )
        .map((p) => `${p.id}:${p.apiKey ? '1' : '0'}:${p.enabled ? '1' : '0'}`)
        .join(','),
    [settings.providers],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/speech/voices`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { voices: [] }))
      .then((data) => {
        if (data?.voices && Array.isArray(data.voices)) {
          setVoices(data.voices);
          setVoicesFetchError(false);
        }
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setVoicesFetchError(true);
      });
    return () => controller.abort();
  }, [speechProviderKey]);

  const filteredVoices = useMemo(() => {
    const provider = speech.ttsProvider;
    if (provider === 'auto') return voices;
    if (provider === 'kokoro')
      return voices.filter((v) => v.name.startsWith('[Kokoro]'));
    if (provider === 'pocket')
      return voices.filter((v) => v.name.startsWith('[Pocket-TTS]'));
    if (provider === 'kitten')
      return voices.filter((v) => v.name.startsWith('[Kitten]'));
    if (provider === 'elevenlabs')
      return voices.filter((v) => v.name.startsWith('[ElevenLabs]'));
    if (provider === 'local') {
      return voices.filter(
        (v) =>
          v.name.startsWith('[Kokoro]') ||
          v.name.startsWith('[Pocket-TTS]') ||
          v.name.startsWith('[Kitten]'),
      );
    }
    return voices.filter(
      (v) =>
        !v.name.startsWith('[Kokoro]') &&
        !v.name.startsWith('[Pocket-TTS]') &&
        !v.name.startsWith('[Kitten]'),
    );
  }, [voices, speech.ttsProvider]);

  const groupedVoices = useMemo(() => {
    const groups: Record<string, typeof filteredVoices> = {};
    for (const v of filteredVoices) {
      const match = v.name.match(/^\[([^\]]+)\]/);
      const provider = match?.[1] ?? 'Other';

      // ElevenLabs voices: group by language for better organization
      let group: string;
      if (provider === 'ElevenLabs' && v.language) {
        const langLabel = resolveLanguageLabel(v.language, s);
        group = `ElevenLabs · ${langLabel}`;
      } else {
        group = provider;
      }

      if (!groups[group]) groups[group] = [];
      groups[group].push(v);
    }
    return groups;
  }, [filteredVoices, s]);

  // Auto-select first voice when provider changes and current voice isn't in list
  useEffect(() => {
    if (
      filteredVoices.length > 0 &&
      !filteredVoices.some((v) => v.id === speech.ttsVoice)
    ) {
      updateSpeech({ ttsVoice: filteredVoices[0].id });
    }
  }, [filteredVoices, speech.ttsVoice, updateSpeech]);

  // ── TTS test ─────────────────────────────────────────────────────────────────
  const {
    ttsTestText,
    setTtsTestText,
    ttsTestState,
    ttsTestError,
    testTTS,
    stopTTSTest,
  } = useTtsTest({
    voice: speech.ttsVoice,
    speed: speech.ttsSpeed,
    format: speech.ttsFormat,
    provider: speech.ttsProvider,
    filteredVoices,
  });

  // ── Voice cloning ─────────────────────────────────────────────────────────────
  const {
    cloneName,
    setCloneName,
    cloneError,
    cloneUploading,
    clonedVoices,
    fileInputRef,
    cloneRecording,
    cloneRecordDuration,
    handleCloneUpload,
    handleCloneDelete,
    handleCloneTest,
    startCloneRecording,
    stopCloneRecording,
  } = useVoiceCloning({ setVoices });

  // ── Derived ────────────────────────────────────────────────────────────────
  const pocketReady = localStatus?.tts?.pocket?.state === 'ready';
  const voiceCloningSupported =
    pocketReady &&
    (speech.ttsProvider === 'auto' ||
      speech.ttsProvider === 'local' ||
      speech.ttsProvider === 'pocket');

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <section className="space-y-4">
      <SectionHeader
        icon={<Volume2 size={16} className="text-muted-foreground" />}
        title={s.speechTts}
      />

      <SettingRow label={s.speechTtsEnable} description={s.speechTtsEnableDesc}>
        <Switch
          checked={speech.ttsEnabled}
          onChange={(v) => updateSpeech({ ttsEnabled: v })}
        />
      </SettingRow>

      <div
        className={`space-y-4 transition-opacity ${!speech.ttsEnabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        {/* Provider + Voice */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-foreground/80 mb-1 block text-sm font-medium">
              {s.speechTtsProvider}
            </label>
            <select
              aria-label={s.speechTtsProvider}
              value={speech.ttsProvider}
              onChange={(e) => updateSpeech({ ttsProvider: e.target.value })}
              className={INPUT_CLASS}
            >
              <option value="auto">{s.speechTtsProviderAuto}</option>
              {settings.providers.some(
                (p) => p.id === 'elevenlabs' && p.apiKey && p.enabled,
              ) && (
                <option value="elevenlabs">
                  {s.speechTtsProviderElevenLabs ?? 'ElevenLabs'}
                </option>
              )}
              {localStatus?.tts?.kokoro?.state === 'ready' && (
                <option value="kokoro">
                  {s.speechTtsProviderKokoro ?? 'Kokoro (local)'}
                </option>
              )}
              {localStatus?.tts?.pocket?.state === 'ready' && (
                <option value="pocket">
                  {s.speechTtsProviderPocket ?? 'Pocket-TTS (local)'}
                </option>
              )}
              {localStatus?.tts?.kitten?.state === 'ready' && (
                <option value="kitten">
                  {s.speechTtsProviderKitten ?? 'Kitten (local)'}
                </option>
              )}
            </select>
          </div>

          <div>
            <label className="text-foreground/80 mb-1 block text-sm font-medium">
              {s.speechTtsVoice}
            </label>
            <select
              aria-label={s.speechTtsVoice}
              value={speech.ttsVoice}
              onChange={(e) => updateSpeech({ ttsVoice: e.target.value })}
              className={INPUT_CLASS}
            >
              {filteredVoices.length === 0 && (
                <option value={speech.ttsVoice}>
                  {voicesFetchError
                    ? s.speechTtsVoiceLoadError
                    : speech.ttsVoice || s.speechTtsVoiceDefault}
                </option>
              )}
              {Object.keys(groupedVoices).length > 0
                ? Object.entries(groupedVoices).map(([group, groupVoices]) => {
                    const isLangGroup = group.startsWith('ElevenLabs ·');
                    return (
                      <optgroup key={group} label={group}>
                        {groupVoices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {formatVoiceLabel(v, s, isLangGroup)}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })
                : filteredVoices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
            </select>
          </div>
        </div>

        <RangeSlider
          label={tt('settings.speechTtsSpeed', {
            speed: speech.ttsSpeed.toFixed(1),
          })}
          min={0.5}
          max={2.0}
          step={0.1}
          value={speech.ttsSpeed}
          onChange={(v) => updateSpeech({ ttsSpeed: v })}
          minLabel="0.5x"
          maxLabel="2.0x"
        />

        <SettingRow label={s.speechTtsAutoRead}>
          <select
            aria-label={s.speechTtsAutoRead}
            value={speech.ttsAutoRead}
            onChange={(e) =>
              updateSpeech({ ttsAutoRead: e.target.value as 'off' | 'always' })
            }
            className="border-input bg-background text-foreground rounded-md border px-2 py-1.5 text-sm"
          >
            <option value="off">{s.speechTtsAutoReadOff}</option>
            <option value="always">{s.speechTtsAutoReadAlways}</option>
          </select>
        </SettingRow>

        <SettingRow
          label={s.speechTtsStreaming}
          description={s.speechTtsStreamingDesc}
        >
          <Switch
            checked={speech.ttsStreaming}
            onChange={(v) => updateSpeech({ ttsStreaming: v })}
          />
        </SettingRow>

        <TtsTestPanel
          ttsTestText={ttsTestText}
          onTextChange={setTtsTestText}
          ttsTestState={ttsTestState}
          ttsTestError={ttsTestError}
          onTest={testTTS}
          onStop={stopTTSTest}
        />

        {localStatus && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {s.speechLocalModels}
            </p>
            <LocalModelBadge
              model="kokoro"
              label={s.speechLocalTtsKokoroLabel ?? 'Kokoro (~180 MB)'}
              status={localStatus.tts?.kokoro}
              onDownload={onDownload}
            />
            <LocalModelBadge
              model="pocket"
              label={s.speechLocalTtsPocketLabel ?? 'Pocket-TTS (~94 MB)'}
              status={localStatus.tts?.pocket}
              onDownload={onDownload}
            />
            <LocalModelBadge
              model="kitten"
              label={s.speechLocalTtsKittenLabel ?? 'Kitten (~25 MB)'}
              status={localStatus.tts?.kitten}
              onDownload={onDownload}
            />
          </div>
        )}

        <VoiceCloningPanel
          voiceCloningEnabled={speech.voiceCloningEnabled}
          onVoiceCloningToggle={(v) => updateSpeech({ voiceCloningEnabled: v })}
          voiceCloningSupported={voiceCloningSupported}
          pocketReady={pocketReady}
          cloneName={cloneName}
          setCloneName={setCloneName}
          cloneError={cloneError}
          cloneUploading={cloneUploading}
          clonedVoices={clonedVoices}
          fileInputRef={fileInputRef}
          cloneRecording={cloneRecording}
          cloneRecordDuration={cloneRecordDuration}
          onUpload={handleCloneUpload}
          onDelete={handleCloneDelete}
          onTest={handleCloneTest}
          onStartRecording={startCloneRecording}
          onStopRecording={stopCloneRecording}
        />
      </div>
    </section>
  );
}
