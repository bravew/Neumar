import { useCallback, useMemo, useState } from 'react';

import { Sparkles } from 'lucide-react';

import { normalizeThinkingForModel } from '@/components/shared/model-compatibility';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import { AvatarPicker } from '../AvatarPicker';
import { Combobox } from '../Combobox';
import {
  getModelsForRuntime,
  getProviderCapabilities,
  INPUT_CLASS,
  LABEL_CLASS,
  runtimeSupportsThinking,
  SELECT_CLASS,
} from '../profile-constants';
import type { ProviderInfo } from '../profile-constants';
import type { ProfileFormData } from '../ProfileDialog';
import { SoulTemplatePicker } from '../SoulTemplatePicker';
import {
  ThinkingConfigFields,
  useThinkingModelSync,
} from '../ThinkingConfigFields';
import { QuickSetupCard } from './QuickSetupCard';

// ============================================================================
// Component
// ============================================================================

interface ProfileDetailSidebarProps {
  form: ProfileFormData;
  setForm: React.Dispatch<React.SetStateAction<ProfileFormData>>;
  providers: ProviderInfo[];
  profileId: string;
}

export function ProfileDetailSidebar({
  form,
  setForm,
  providers,
  profileId,
}: ProfileDetailSidebarProps) {
  const { t, language } = useLanguage();
  const [pickerOpen, setPickerOpen] = useState(false);

  const runtimeOptions = useMemo(
    () =>
      providers.map((p) => ({
        value: p.type,
        label: p.available === false ? `${p.name} (unavailable)` : p.name,
        description: p.description,
      })),
    [providers],
  );

  const modelOptions = useMemo(
    () => getModelsForRuntime(form.runtime_id, providers, t.profiles),
    [form.runtime_id, providers, t.profiles],
  );

  const selectedProvider = useMemo(
    () => providers.find((p) => p.type === form.runtime_id),
    [providers, form.runtime_id],
  );

  const providerCapabilities = useMemo(
    () => getProviderCapabilities(selectedProvider),
    [selectedProvider],
  );

  useThinkingModelSync(form.default_model, setForm);

  // Reset model if runtime changes and current model is invalid.
  // Also clear thinking_config when switching to a runtime that doesn't support it.
  const handleRuntimeChange = useCallback(
    (runtime_id: string) => {
      setForm((prev) => {
        const models = getModelsForRuntime(runtime_id, providers, t.profiles);
        const modelValid = models.some((m) => m.value === prev.default_model);
        const supportsThinking = runtimeSupportsThinking(runtime_id);
        const defaultModel = modelValid
          ? prev.default_model
          : (models[0]?.value ?? '');
        return {
          ...prev,
          runtime_id,
          default_model: defaultModel,
          thinking_config: supportsThinking
            ? normalizeThinkingForModel(defaultModel, prev.thinking_config)
            : null,
        };
      });
    },
    [setForm, providers, t.profiles],
  );

  const handleTemplateApplied = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/soul/agent-profiles/${profileId}`,
      );
      if (res.ok) {
        const data = (await res.json()) as {
          soul: AgentSoul | null;
          soul_version: number;
          soul_origin: string;
        };
        if (data.soul) {
          setForm((prev) => ({
            ...prev,
            soul: data.soul,
            soul_version: data.soul_version,
            soul_origin: data.soul_origin as ProfileFormData['soul_origin'],
          }));
        }
      }
    } catch {
      // silently fail
    }
  }, [profileId, setForm]);

  return (
    <aside className="border-border w-80 shrink-0 space-y-5 overflow-y-auto border-r p-5">
      {/* Avatar */}
      <div className="flex justify-center">
        <AvatarPicker
          selectedIcon={form.avatar_icon}
          selectedColor={form.avatar_color}
          onIconChange={(icon) =>
            setForm((prev) => ({ ...prev, avatar_icon: icon }))
          }
          onColorChange={(color) =>
            setForm((prev) => ({ ...prev, avatar_color: color }))
          }
        />
      </div>

      {/* Name */}
      <div>
        <label className={LABEL_CLASS}>
          {t.profiles.name} <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, name: e.target.value }))
          }
          placeholder={t.profiles.name}
          className={INPUT_CLASS}
        />
      </div>

      {/* Status */}
      <div>
        <label className={LABEL_CLASS}>{t.profiles.status}</label>
        <select
          value={form.status}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              status: e.target.value as ProfileFormData['status'],
            }))
          }
          className={SELECT_CLASS}
        >
          <option value="active">{t.profiles.active}</option>
          <option value="paused">{t.profiles.paused}</option>
          <option value="archived">{t.profiles.archived}</option>
        </select>
      </div>

      {/* Runtime */}
      <div>
        <label className={LABEL_CLASS}>
          {t.profiles.runtime} <span className="text-red-400">*</span>
        </label>
        <Combobox
          value={form.runtime_id}
          onChange={handleRuntimeChange}
          options={runtimeOptions}
          placeholder={t.profiles.selectRuntime}
        />

        {/* Availability warning */}
        {selectedProvider?.available === false && (
          <p className="mt-1.5 text-[11px] leading-snug text-yellow-500/80">
            ⚠ Runtime unavailable — install the required CLI or configure an API
            key in Settings.
          </p>
        )}

        {/* Capability badges */}
        {providerCapabilities.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {providerCapabilities.map((cap) => (
              <span
                key={cap.label}
                title={cap.title}
                className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium"
              >
                {cap.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Model */}
      {modelOptions.length > 0 && (
        <div>
          <label className={LABEL_CLASS}>{t.profiles.model}</label>
          <Combobox
            value={form.default_model}
            onChange={(m) =>
              setForm((prev) => ({
                ...prev,
                default_model: m,
                thinking_config: normalizeThinkingForModel(
                  m,
                  prev.thinking_config,
                ),
              }))
            }
            options={modelOptions}
            placeholder={t.profiles.model}
          />
        </div>
      )}

      {/* Thinking Config — Claude only */}
      {runtimeSupportsThinking(form.runtime_id) && (
        <ThinkingConfigFields
          form={form}
          setForm={setForm}
          idPrefix="profile"
          p={t.profiles}
        />
      )}

      {/* Quick Setup (when no soul) */}
      {!form.soul && (
        <QuickSetupCard
          profileId={profileId}
          onSoulGenerated={(soul) =>
            setForm((prev) => ({ ...prev, soul, soul_origin: 'user' }))
          }
          onChooseTemplate={() => setPickerOpen(true)}
        />
      )}

      {/* Soul summary + Template button */}
      <div className="border-border space-y-2 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Sparkles className="size-3.5" />
            {t.profiles.soulEditor}
            {form.soul && (
              <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px] font-medium">
                v{form.soul_version}
              </span>
            )}
          </label>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            {t.profiles.chooseSoulTemplate}
          </button>
        </div>
        {form.soul && (
          <div className="text-muted-foreground space-y-0.5 text-xs">
            <div>
              <span className="text-foreground/70 font-medium">
                {t.profiles.soulRole}:
              </span>{' '}
              {form.soul.identity.role || '—'}
            </div>
            <div>
              <span className="text-foreground/70 font-medium">
                {t.profiles.soulTone}:
              </span>{' '}
              {form.soul.voice.tone || '—'}
            </div>
          </div>
        )}
        {!form.soul && (
          <p className="text-muted-foreground/60 text-xs">
            {t.profiles.noSoulForPreview}
          </p>
        )}
      </div>

      <SoulTemplatePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        profileId={profileId}
        language={language}
        onApplied={handleTemplateApplied}
        t={t}
      />
    </aside>
  );
}
