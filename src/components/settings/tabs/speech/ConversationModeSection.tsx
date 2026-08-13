/**
 * ConversationModeSection
 *
 * Voice conversation mode settings:
 * VAD sensitivity, silence threshold, barge-in, and filler audio.
 */

import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../../components/Switch';
import type { SettingsTabProps } from '../../types';
import { useSpeechUpdate } from './hooks/useSpeechUpdate';
import { RangeSlider } from './RangeSlider';
import { SettingRow } from './SettingRow';

type Props = Pick<SettingsTabProps, 'settings' | 'onSettingsChange'>;

export function ConversationModeSection({ settings, onSettingsChange }: Props) {
  const { t, tt } = useLanguage();
  const s = t.settings;
  const speech = settings.speech;
  const updateSpeech = useSpeechUpdate(settings, onSettingsChange);

  return (
    <section className="space-y-4">
      <SettingRow
        label={s.speechConvEnable}
        description={s.speechConvEnableDesc}
      >
        <Switch
          checked={speech.conversationMode}
          onChange={(v) => updateSpeech({ conversationMode: v })}
        />
      </SettingRow>

      <div
        className={`space-y-4 transition-opacity ${!speech.conversationMode ? 'pointer-events-none opacity-50' : ''}`}
      >
        <RangeSlider
          label={tt('settings.speechConvVad', {
            value: speech.vadSensitivity.toFixed(2),
          })}
          min={0.0}
          max={1.0}
          step={0.05}
          value={speech.vadSensitivity}
          onChange={(v) => updateSpeech({ vadSensitivity: v })}
          minLabel={s.speechConvVadLow}
          maxLabel={s.speechConvVadHigh}
        />

        <RangeSlider
          label={tt('settings.speechConvSilence', {
            value: speech.silenceThreshold,
          })}
          min={300}
          max={2000}
          step={50}
          value={speech.silenceThreshold}
          onChange={(v) => updateSpeech({ silenceThreshold: v })}
          minLabel={s.speechConvSilenceMin}
          maxLabel={s.speechConvSilenceMax}
          parse="int"
        />

        <SettingRow
          label={s.speechConvBargeIn}
          description={s.speechConvBargeInDesc}
        >
          <Switch
            checked={speech.bargeInEnabled}
            onChange={(v) => updateSpeech({ bargeInEnabled: v })}
          />
        </SettingRow>

        <SettingRow
          label={s.speechConvFiller}
          description={s.speechConvFillerDesc}
        >
          <Switch
            checked={speech.fillerAudioEnabled}
            onChange={(v) => updateSpeech({ fillerAudioEnabled: v })}
          />
        </SettingRow>
      </div>
    </section>
  );
}
