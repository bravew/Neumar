import { useCallback } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import { EditableList } from './EditableList';
import {
  SOUL_INPUT_CLASS,
  SOUL_LABEL_CLASS,
  SOUL_TEXTAREA_CLASS,
} from './soul-constants';

// ============================================================================
// SoulIdentityTab
// ============================================================================

export interface SoulIdentityTabProps {
  soul: AgentSoul;
  onChange: (soul: AgentSoul) => void;
}

export function SoulIdentityTab({ soul, onChange }: SoulIdentityTabProps) {
  const { t } = useLanguage();

  const updateRole = useCallback(
    (role: string) => {
      onChange({ ...soul, identity: { ...soul.identity, role } });
    },
    [soul, onChange],
  );

  const updateCoreValues = useCallback(
    (core_values: string[]) => {
      onChange({ ...soul, identity: { ...soul.identity, core_values } });
    },
    [soul, onChange],
  );

  const updateWorldview = useCallback(
    (worldview: string) => {
      onChange({
        ...soul,
        identity: { ...soul.identity, worldview: worldview || undefined },
      });
    },
    [soul, onChange],
  );

  const updateOpinions = useCallback(
    (opinions: string[]) => {
      onChange({
        ...soul,
        identity: {
          ...soul.identity,
          opinions: opinions.length > 0 ? opinions : undefined,
        },
      });
    },
    [soul, onChange],
  );

  return (
    <div className="space-y-5">
      {/* Role */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulRole}</label>
        <input
          type="text"
          placeholder={t.profiles.soulRoleDesc}
          value={soul.identity.role}
          onChange={(e) => updateRole(e.target.value)}
          className={SOUL_INPUT_CLASS}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulRoleDesc}
        </p>
      </div>

      {/* Core Values */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulCoreValues}</label>
        <EditableList
          items={soul.identity.core_values}
          onChange={updateCoreValues}
          placeholder={t.profiles.soulCoreValuesPlaceholder}
          minItems={1}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulCoreValuesDesc}
        </p>
      </div>

      {/* Worldview */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulWorldview}</label>
        <textarea
          placeholder={t.profiles.soulWorldviewPlaceholder}
          value={soul.identity.worldview ?? ''}
          onChange={(e) => updateWorldview(e.target.value)}
          rows={3}
          className={SOUL_TEXTAREA_CLASS}
        />
      </div>

      {/* Opinions */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulOpinions}</label>
        <EditableList
          items={soul.identity.opinions ?? []}
          onChange={updateOpinions}
          placeholder={t.profiles.soulOpinionsPlaceholder}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulOpinionsDesc}
        </p>
      </div>
    </div>
  );
}
