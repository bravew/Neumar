import { useCallback } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import { EditableList } from './EditableList';
import { SOUL_INPUT_CLASS, SOUL_LABEL_CLASS } from './soul-constants';

// ============================================================================
// SoulVoiceTab
// ============================================================================

export interface SoulVoiceTabProps {
  soul: AgentSoul;
  onChange: (soul: AgentSoul) => void;
}

export function SoulVoiceTab({ soul, onChange }: SoulVoiceTabProps) {
  const { t } = useLanguage();

  const updateTone = useCallback(
    (tone: string) => {
      onChange({ ...soul, voice: { ...soul.voice, tone } });
    },
    [soul, onChange],
  );

  const updateGreeting = useCallback(
    (greeting: string) => {
      onChange({
        ...soul,
        voice: { ...soul.voice, greeting: greeting || undefined },
      });
    },
    [soul, onChange],
  );

  const updateStyleRules = useCallback(
    (style_rules: string[]) => {
      onChange({ ...soul, voice: { ...soul.voice, style_rules } });
    },
    [soul, onChange],
  );

  const updateExamplePhrases = useCallback(
    (example_phrases: string[]) => {
      onChange({
        ...soul,
        voice: {
          ...soul.voice,
          example_phrases:
            example_phrases.length > 0 ? example_phrases : undefined,
        },
      });
    },
    [soul, onChange],
  );

  const updateAntiPatterns = useCallback(
    (anti_patterns: string[]) => {
      onChange({
        ...soul,
        voice: {
          ...soul.voice,
          anti_patterns: anti_patterns.length > 0 ? anti_patterns : undefined,
        },
      });
    },
    [soul, onChange],
  );

  return (
    <div className="space-y-5">
      {/* Tone */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulTone}</label>
        <input
          type="text"
          placeholder={t.profiles.soulTonePlaceholder}
          value={soul.voice.tone}
          onChange={(e) => updateTone(e.target.value)}
          className={SOUL_INPUT_CLASS}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulToneDesc}
        </p>
      </div>

      {/* Greeting */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulGreeting}</label>
        <input
          type="text"
          placeholder={t.profiles.soulGreetingPlaceholder}
          value={soul.voice.greeting ?? ''}
          onChange={(e) => updateGreeting(e.target.value)}
          className={SOUL_INPUT_CLASS}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulGreetingDesc}
        </p>
      </div>

      {/* Style Rules */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulStyleRules}</label>
        <EditableList
          items={soul.voice.style_rules}
          onChange={updateStyleRules}
          placeholder={t.profiles.soulStyleRulesPlaceholder}
          minItems={1}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulStyleRulesDesc}
        </p>
      </div>

      {/* Example Phrases */}
      <div>
        <label className={SOUL_LABEL_CLASS}>
          {t.profiles.soulExamplePhrases}
        </label>
        <EditableList
          items={soul.voice.example_phrases ?? []}
          onChange={updateExamplePhrases}
          placeholder={t.profiles.soulExamplePhrasesPlaceholder}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulExamplePhrasesDesc}
        </p>
      </div>

      {/* Anti-Patterns */}
      <div>
        <label className={SOUL_LABEL_CLASS}>
          {t.profiles.soulAntiPatterns}
        </label>
        <EditableList
          items={soul.voice.anti_patterns ?? []}
          onChange={updateAntiPatterns}
          placeholder={t.profiles.soulAntiPatternsPlaceholder}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulAntiPatternsDesc}
        </p>
      </div>
    </div>
  );
}
