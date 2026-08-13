import { useCallback } from 'react';

import type { SettingsTabProps } from '../../../types';

type SpeechSettings = SettingsTabProps['settings']['speech'];

/** Returns a stable `updateSpeech` callback that merges a partial into speech settings. */
export function useSpeechUpdate(
  settings: SettingsTabProps['settings'],
  onSettingsChange: SettingsTabProps['onSettingsChange'],
): (partial: Partial<SpeechSettings>) => void {
  return useCallback(
    (partial) => {
      onSettingsChange({
        ...settings,
        speech: { ...settings.speech, ...partial },
      });
    },
    [settings, onSettingsChange],
  );
}
