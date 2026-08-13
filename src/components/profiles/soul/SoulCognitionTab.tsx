import { useCallback } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import { EditableList } from './EditableList';
import { KeyValueEditor } from './KeyValueEditor';
import { SOUL_LABEL_CLASS, SOUL_TEXTAREA_CLASS } from './soul-constants';
import { TagInput } from './TagInput';

// ============================================================================
// SoulCognitionTab
// ============================================================================

export interface SoulCognitionTabProps {
  soul: AgentSoul;
  onChange: (soul: AgentSoul) => void;
}

export function SoulCognitionTab({ soul, onChange }: SoulCognitionTabProps) {
  const { t } = useLanguage();

  const updateReasoningStyle = useCallback(
    (reasoning_style: string) => {
      onChange({
        ...soul,
        cognition: { ...soul.cognition, reasoning_style },
      });
    },
    [soul, onChange],
  );

  const updateExpertise = useCallback(
    (expertise: string[]) => {
      onChange({
        ...soul,
        cognition: {
          ...soul.cognition,
          expertise: expertise.length > 0 ? expertise : undefined,
        },
      });
    },
    [soul, onChange],
  );

  const updateOperatingModes = useCallback(
    (operating_modes: Record<string, string>) => {
      onChange({
        ...soul,
        cognition: {
          ...soul.cognition,
          operating_modes:
            Object.keys(operating_modes).length > 0
              ? operating_modes
              : undefined,
        },
      });
    },
    [soul, onChange],
  );

  const updateApproachPreferences = useCallback(
    (approach_preferences: string[]) => {
      onChange({
        ...soul,
        cognition: {
          ...soul.cognition,
          approach_preferences:
            approach_preferences.length > 0 ? approach_preferences : undefined,
        },
      });
    },
    [soul, onChange],
  );

  return (
    <div className="space-y-5">
      {/* Reasoning Style */}
      <div>
        <label className={SOUL_LABEL_CLASS}>
          {t.profiles.soulReasoningStyle}
        </label>
        <textarea
          placeholder={t.profiles.soulReasoningStylePlaceholder}
          value={soul.cognition.reasoning_style}
          onChange={(e) => updateReasoningStyle(e.target.value)}
          rows={3}
          className={SOUL_TEXTAREA_CLASS}
        />
      </div>

      {/* Expertise */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulExpertise}</label>
        <TagInput
          tags={soul.cognition.expertise ?? []}
          onChange={updateExpertise}
          placeholder={t.profiles.soulExpertisePlaceholder}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulExpertiseDesc}
        </p>
      </div>

      {/* Operating Modes */}
      <div>
        <label className={SOUL_LABEL_CLASS}>
          {t.profiles.soulOperatingModes}
        </label>
        <KeyValueEditor
          entries={soul.cognition.operating_modes ?? {}}
          onChange={updateOperatingModes}
          keyPlaceholder={t.profiles.soulModeName}
          valuePlaceholder={t.profiles.soulModeDescription}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulOperatingModesDesc}
        </p>
      </div>

      {/* Approach Preferences */}
      <div>
        <label className={SOUL_LABEL_CLASS}>
          {t.profiles.soulApproachPrefs}
        </label>
        <EditableList
          items={soul.cognition.approach_preferences ?? []}
          onChange={updateApproachPreferences}
          placeholder={t.profiles.soulApproachPrefsPlaceholder}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulApproachPrefsDesc}
        </p>
      </div>
      {/* Skill Bundles (read-only display) */}
      {soul.cognition.skill_bundles &&
        soul.cognition.skill_bundles.length > 0 && (
          <div>
            <label className={SOUL_LABEL_CLASS}>
              {t.profiles.soulSkillBundles}
            </label>
            <div className="space-y-2">
              {soul.cognition.skill_bundles.map((skill) => (
                <div
                  key={skill.name}
                  className="bg-muted/30 border-border rounded-lg border p-3"
                >
                  <div className="text-sm font-medium">{skill.name}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {skill.description}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs italic">
                    {skill.approach}
                  </div>
                  {skill.trigger && (
                    <div className="text-muted-foreground mt-1 text-xs">
                      {t.profiles.soulSkillTrigger}: {skill.trigger}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {t.profiles.soulSkillBundlesDesc}
            </p>
          </div>
        )}
    </div>
  );
}
