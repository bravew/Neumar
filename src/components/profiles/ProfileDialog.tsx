import { useCallback, useEffect, useMemo, useState } from 'react';

import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useMcpServers } from '@/shared/hooks/useMcpServers';
import { useSkills } from '@/shared/hooks/useSkills';
import { cn } from '@/shared/lib/utils';
import type { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul, SoulOrigin } from '@/shared/types/agent-profile';

import { AvatarPicker } from './AvatarPicker';
import { Combobox } from './Combobox';
import { McpSkillsPicker } from './McpSkillsPicker';
import {
  getModelsForRuntime,
  getProviderCapabilities,
  getRoleComboOptions,
  INPUT_CLASS,
  LABEL_CLASS,
  ROLE_PRESETS,
  runtimeSupportsThinking,
  SELECT_CLASS,
  type ProfileRoutingHints,
  type ProviderInfo,
} from './profile-constants';
import { SoulSection } from './SoulSection';

// ============================================================================
// Types
// ============================================================================

export interface ThinkingConfigData {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface ProfileFormData {
  name: string;
  role: string;
  description: string;
  avatar_color: string;
  avatar_icon: string;
  runtime_id: string;
  default_model: string;
  system_prompt: string;
  soul: AgentSoul | null;
  soul_version: number;
  soul_origin: SoulOrigin;
  status: 'active' | 'paused' | 'archived';
  default_mcp_servers: string[];
  /** null = allow all (no restrictions), string[] = specific skills only */
  default_skills: string[] | null;
  max_concurrent_tasks: number;
  thinking_config: ThinkingConfigData | null;
  routing_hints: ProfileRoutingHints | null;
}

// ============================================================================
// Required label
// ============================================================================

function RequiredLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn(LABEL_CLASS, className)}>
      {children}
      <span className="text-destructive ml-0.5">*</span>
    </label>
  );
}

// ============================================================================
// Main Dialog
// ============================================================================

export function ProfileDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSave,
  saving,
  isEdit,
  profileId,
  language,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ProfileFormData;
  setForm: React.Dispatch<React.SetStateAction<ProfileFormData>>;
  onSave: () => void;
  saving: boolean;
  isEdit: boolean;
  profileId: string | null;
  language: string;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const { servers: mcpServers } = useMcpServers();
  const { skills } = useSkills();

  const roleComboOptions = useMemo(
    () => getRoleComboOptions(t.profiles),
    [t.profiles],
  );
  const modelOptions = useMemo(
    () => getModelsForRuntime(form.runtime_id, providers, t.profiles),
    [form.runtime_id, providers, t.profiles],
  );
  const runtimeOptions = useMemo(
    () =>
      providers.map((p) => ({
        value: p.type,
        label: p.available === false ? `${p.name} (unavailable)` : p.name,
        description: p.description,
      })),
    [providers],
  );
  const selectedProvider = useMemo(
    () => providers.find((p) => p.type === form.runtime_id),
    [providers, form.runtime_id],
  );
  const providerCapabilities = useMemo(
    () => getProviderCapabilities(selectedProvider),
    [selectedProvider],
  );

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    fetch(`${API_BASE_URL}/providers/agents`, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : { providers: [] }))
      .then((data) => setProviders(data.providers ?? []))
      .catch(() => {});
    return () => ac.abort();
  }, [open]);

  const handleRoleChange = useCallback(
    (newRole: string) => {
      const preset = ROLE_PRESETS.find((r) => r.value === newRole);
      setForm((p) => {
        const currentMatchesPreset = ROLE_PRESETS.some(
          (r) => r.systemPrompt === p.system_prompt,
        );
        return {
          ...p,
          role: newRole,
          ...(preset && (!p.system_prompt.trim() || currentMatchesPreset)
            ? { system_prompt: preset.systemPrompt, avatar_icon: preset.icon }
            : {}),
        };
      });
    },
    [setForm],
  );

  const handleRuntimeChange = useCallback(
    (newRuntime: string) => {
      const newModels = getModelsForRuntime(newRuntime, providers, t.profiles);
      setForm((p) => {
        const currentModelValid = newModels.some(
          (m) => m.value === p.default_model,
        );
        const supportsThinking = runtimeSupportsThinking(newRuntime);
        return {
          ...p,
          runtime_id: newRuntime,
          thinking_config: supportsThinking ? p.thinking_config : null,
          ...(!currentModelValid
            ? {
                default_model:
                  providers.find((pr) => pr.type === newRuntime)
                    ?.defaultModel ?? '',
              }
            : {}),
        };
      });
    },
    [providers, t.profiles, setForm],
  );

  const toggleMcp = (name: string) =>
    setForm((p) => ({
      ...p,
      default_mcp_servers: p.default_mcp_servers.includes(name)
        ? p.default_mcp_servers.filter((s) => s !== name)
        : [...p.default_mcp_servers, name],
    }));

  const toggleSkill = (slug: string) =>
    setForm((p) => {
      const current = p.default_skills ?? [];
      return {
        ...p,
        default_skills: current.includes(slug)
          ? current.filter((s) => s !== slug)
          : [...current, slug],
      };
    });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="bg-card border-border fixed top-1/2 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-foreground text-lg font-semibold">
              {isEdit ? t.profiles.editProfile : t.profiles.createProfile}
            </Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
            {/* Avatar Picker — icon + color */}
            <AvatarPicker
              selectedIcon={form.avatar_icon}
              selectedColor={form.avatar_color}
              onIconChange={(icon) =>
                setForm((p) => ({ ...p, avatar_icon: icon }))
              }
              onColorChange={(color) =>
                setForm((p) => ({ ...p, avatar_color: color }))
              }
            />

            {/* Name + Status row */}
            <div className="flex gap-3">
              <div className="flex-1">
                <RequiredLabel>{t.profiles.name}</RequiredLabel>
                <input
                  type="text"
                  placeholder={t.profiles.name}
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                  className={INPUT_CLASS}
                  autoFocus
                />
              </div>
              <div className="w-32 shrink-0">
                <label className={LABEL_CLASS}>{t.profiles.status}</label>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
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
            </div>

            {/* Role — combobox with presets */}
            <div>
              <label className={LABEL_CLASS}>{t.profiles.role}</label>
              <Combobox
                value={form.role}
                onChange={handleRoleChange}
                options={roleComboOptions}
                placeholder={t.profiles.role}
                allowCustom
              />
            </div>

            {/* Description */}
            <div>
              <label className={LABEL_CLASS}>{t.profiles.description}</label>
              <input
                type="text"
                placeholder={t.profiles.description}
                value={form.description}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
                className={INPUT_CLASS}
              />
            </div>

            {/* Runtime */}
            <div>
              <RequiredLabel>{t.profiles.runtime}</RequiredLabel>
              <Combobox
                value={form.runtime_id}
                onChange={handleRuntimeChange}
                options={runtimeOptions}
                placeholder={t.profiles.selectRuntime}
              />
              {/* Availability warning */}
              {selectedProvider?.available === false && (
                <p className="mt-1.5 text-[11px] leading-snug text-yellow-500/80">
                  ⚠ Runtime unavailable — install the required CLI or configure
                  an API key in Settings.
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
                  onChange={(m) => setForm((p) => ({ ...p, default_model: m }))}
                  options={modelOptions}
                  placeholder={t.profiles.model}
                />
              </div>
            )}

            {/* Max Concurrent Tasks */}
            <div>
              <label className={LABEL_CLASS}>
                {t.profiles.maxConcurrentTasks}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={form.max_concurrent_tasks}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    max_concurrent_tasks: Math.max(
                      1,
                      parseInt(e.target.value, 10) || 1,
                    ),
                  }))
                }
                className={cn(INPUT_CLASS, 'w-20')}
              />
            </div>

            {/* MCP Servers + Skills side by side */}
            <McpSkillsPicker
              mcpServers={mcpServers}
              skills={skills}
              selectedMcp={form.default_mcp_servers}
              selectedSkills={form.default_skills}
              onToggleMcp={toggleMcp}
              onToggleSkill={toggleSkill}
              onAllowAllSkillsChange={(allowAll) =>
                setForm((p) => ({
                  ...p,
                  default_skills: allowAll ? null : [],
                }))
              }
              t={t}
            />

            {/* System Prompt */}
            <div>
              <label className={LABEL_CLASS}>{t.profiles.systemPrompt}</label>
              {form.soul ? (
                <div className="text-muted-foreground bg-muted/30 rounded-lg border px-3 py-2 text-xs italic">
                  {t.profiles.soulManagedPrompt}
                </div>
              ) : (
                <textarea
                  placeholder={t.profiles.systemPrompt}
                  value={form.system_prompt}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, system_prompt: e.target.value }))
                  }
                  rows={4}
                  className={cn(INPUT_CLASS, 'resize-none')}
                />
              )}
            </div>

            {/* Soul Section */}
            <SoulSection
              soul={form.soul}
              soulVersion={form.soul_version}
              profileId={profileId}
              language={language}
              onSoulChange={(soul) =>
                setForm((p) => ({ ...p, soul, soul_origin: 'user' }))
              }
              onSoulApplied={(soul) =>
                setForm((p) => ({
                  ...p,
                  soul,
                  soul_version: p.soul_version + 1,
                  soul_origin: 'predefined',
                }))
              }
              t={t}
            />

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close className="text-muted-foreground hover:text-foreground rounded-lg px-3 py-1.5 text-sm transition-colors">
                {t.common.cancel}
              </Dialog.Close>
              <button
                onClick={onSave}
                disabled={
                  !form.name.trim() || !form.runtime_id.trim() || saving
                }
                className="bg-primary text-primary-foreground rounded-lg px-4 py-1.5 text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  t.common.save
                )}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
