import { useCallback } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import { EditableList } from './EditableList';
import { SOUL_LABEL_CLASS } from './soul-constants';

// ============================================================================
// SoulBoundariesTab
// ============================================================================

export interface SoulBoundariesTabProps {
  soul: AgentSoul;
  onChange: (soul: AgentSoul) => void;
}

export function SoulBoundariesTab({ soul, onChange }: SoulBoundariesTabProps) {
  const { t } = useLanguage();

  const updateRedLines = useCallback(
    (red_lines: string[]) => {
      onChange({ ...soul, boundaries: { ...soul.boundaries, red_lines } });
    },
    [soul, onChange],
  );

  const updateEscalationRules = useCallback(
    (escalation_rules: string[]) => {
      onChange({
        ...soul,
        boundaries: {
          ...soul.boundaries,
          escalation_rules:
            escalation_rules.length > 0 ? escalation_rules : undefined,
        },
      });
    },
    [soul, onChange],
  );

  const updatePrivacyRules = useCallback(
    (privacy_rules: string[]) => {
      onChange({
        ...soul,
        boundaries: {
          ...soul.boundaries,
          privacy_rules: privacy_rules.length > 0 ? privacy_rules : undefined,
        },
      });
    },
    [soul, onChange],
  );

  const updateActionLimits = useCallback(
    (action_limits: string[]) => {
      onChange({
        ...soul,
        boundaries: {
          ...soul.boundaries,
          action_limits: action_limits.length > 0 ? action_limits : undefined,
        },
      });
    },
    [soul, onChange],
  );

  return (
    <div className="space-y-5">
      {/* Red Lines */}
      <div>
        <div className="mb-1 flex items-center gap-1.5">
          <label className={SOUL_LABEL_CLASS}>{t.profiles.soulRedLines}</label>
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
            {t.profiles.soulRequired}
          </span>
        </div>
        <EditableList
          items={soul.boundaries.red_lines}
          onChange={updateRedLines}
          placeholder={t.profiles.soulRedLinesPlaceholder}
          minItems={1}
          variant="danger"
        />
        <p className="mt-1 text-xs text-red-400/70">
          {t.profiles.soulRedLinesDesc}
        </p>
      </div>

      {/* Escalation Rules */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulEscalation}</label>
        <EditableList
          items={soul.boundaries.escalation_rules ?? []}
          onChange={updateEscalationRules}
          placeholder={t.profiles.soulEscalationPlaceholder}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulEscalationDesc}
        </p>
      </div>

      {/* Privacy Rules */}
      <div>
        <label className={SOUL_LABEL_CLASS}>{t.profiles.soulPrivacy}</label>
        <EditableList
          items={soul.boundaries.privacy_rules ?? []}
          onChange={updatePrivacyRules}
          placeholder={t.profiles.soulPrivacyPlaceholder}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulPrivacyDesc}
        </p>
      </div>

      {/* Action Limits */}
      <div>
        <label className={SOUL_LABEL_CLASS}>
          {t.profiles.soulActionLimits}
        </label>
        <EditableList
          items={soul.boundaries.action_limits ?? []}
          onChange={updateActionLimits}
          placeholder={t.profiles.soulActionLimitsPlaceholder}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          {t.profiles.soulActionLimitsDesc}
        </p>
      </div>
    </div>
  );
}
