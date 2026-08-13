/**
 * Thinking-configuration form fields shared by the profile detail sidebar and
 * the profile wizard. Both surfaces edit the same `thinking_config` shape and
 * must offer the same model-compatible choices, so the controls — and the
 * model-change normalization that keeps them valid — live here once.
 */

import { useEffect } from 'react';

import {
  CLAUDE_EFFORT_LEVELS,
  compatibleThinkingTypes,
  DEFAULT_CLAUDE_EFFORT,
  normalizeThinkingForModel,
} from '@/components/shared/model-compatibility';

import { INPUT_CLASS, LABEL_CLASS, SELECT_CLASS } from './profile-constants';
import type { ProfileFormData, ThinkingConfigData } from './ProfileDialog';

const DEFAULT_BUDGET_TOKENS = 10000;

type SetProfileForm = (
  updater: (prev: ProfileFormData) => ProfileFormData,
) => void;

/**
 * Drop a thinking mode the selected model cannot run (e.g. explicit budget
 * tokens on an adaptive-only model) as soon as the model changes.
 */
export function useThinkingModelSync(
  defaultModel: string,
  setForm: SetProfileForm,
): void {
  useEffect(() => {
    setForm((prev) => {
      const normalized = normalizeThinkingForModel(
        prev.default_model,
        prev.thinking_config,
      );
      return normalized === prev.thinking_config
        ? prev
        : { ...prev, thinking_config: normalized };
    });
  }, [defaultModel, setForm]);
}

export interface ThinkingConfigFieldsProps {
  form: ProfileFormData;
  setForm: SetProfileForm;
  /** Namespaced so the sidebar and wizard can render side by side. */
  idPrefix: string;
  /** `t.profiles` message bag. */
  p: Record<string, string>;
}

export function ThinkingConfigFields({
  form,
  setForm,
  idPrefix,
  p,
}: ThinkingConfigFieldsProps) {
  const tc = form.thinking_config;
  const thinkingTypes = compatibleThinkingTypes(form.default_model);
  const typeLabels: Record<string, string> = {
    adaptive: p.thinkingAdaptive,
    enabled: p.thinkingEnabled,
    disabled: p.thinkingDisabled,
  };
  const effortLabels: Record<string, string> = {
    low: p.effortLow,
    medium: p.effortMedium,
    high: p.effortHigh,
    xhigh: p.effortXhigh,
    max: p.effortMax,
  };

  return (
    <div>
      <label htmlFor={`${idPrefix}-thinking-type`} className={LABEL_CLASS}>
        {p.thinkingConfig}
      </label>
      <select
        id={`${idPrefix}-thinking-type`}
        value={tc?.type ?? ''}
        onChange={(e) => {
          const val = e.target.value;
          if (!val) {
            setForm((prev) => ({ ...prev, thinking_config: null }));
            return;
          }
          const type = val as ThinkingConfigData['type'];
          setForm((prev) => ({
            ...prev,
            thinking_config: {
              type,
              ...(type === 'adaptive' ? { effort: DEFAULT_CLAUDE_EFFORT } : {}),
              ...(type === 'enabled'
                ? { budgetTokens: DEFAULT_BUDGET_TOKENS }
                : {}),
            },
          }));
        }}
        className={SELECT_CLASS}
      >
        <option value="">{p.thinkingNone}</option>
        {thinkingTypes.map((type) => (
          <option key={type} value={type}>
            {typeLabels[type]}
          </option>
        ))}
      </select>

      {tc?.type === 'adaptive' && (
        <div className="mt-2">
          <label
            htmlFor={`${idPrefix}-thinking-effort`}
            className={`${LABEL_CLASS} text-[11px]`}
          >
            {p.thinkingEffort}
          </label>
          <select
            id={`${idPrefix}-thinking-effort`}
            value={tc.effort ?? DEFAULT_CLAUDE_EFFORT}
            onChange={(e) =>
              setForm((prev) => {
                if (!prev.thinking_config) return prev;
                return {
                  ...prev,
                  thinking_config: {
                    ...prev.thinking_config,
                    effort: e.target.value as ThinkingConfigData['effort'],
                  },
                };
              })
            }
            className={SELECT_CLASS}
          >
            {CLAUDE_EFFORT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {effortLabels[level]}
              </option>
            ))}
          </select>
        </div>
      )}

      {tc?.type === 'enabled' && (
        <div className="mt-2">
          <label
            htmlFor={`${idPrefix}-thinking-budget`}
            className={`${LABEL_CLASS} text-[11px]`}
          >
            {p.thinkingBudget}
          </label>
          <input
            id={`${idPrefix}-thinking-budget`}
            type="number"
            min={1000}
            max={128000}
            step={1000}
            value={tc.budgetTokens ?? DEFAULT_BUDGET_TOKENS}
            onChange={(e) =>
              setForm((prev) => {
                if (!prev.thinking_config) return prev;
                return {
                  ...prev,
                  thinking_config: {
                    ...prev.thinking_config,
                    budgetTokens:
                      Number(e.target.value) || DEFAULT_BUDGET_TOKENS,
                  },
                };
              })
            }
            className={INPUT_CLASS}
          />
        </div>
      )}
    </div>
  );
}
