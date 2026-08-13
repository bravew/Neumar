/**
 * Wizard Step 3 — Configure: runtime, model, thinking, soul editor, MCP servers, skills, max tasks.
 */

import { useCallback, useMemo } from 'react';

import { Combobox } from '@/components/profiles/Combobox';
import { McpSkillsPicker } from '@/components/profiles/McpSkillsPicker';
import {
  getModelsForRuntime,
  getProviderCapabilities,
  INPUT_CLASS,
  LABEL_CLASS,
  runtimeSupportsThinking,
} from '@/components/profiles/profile-constants';
import type { ProviderInfo } from '@/components/profiles/profile-constants';
import type { ProfileFormData } from '@/components/profiles/ProfileDialog';
import {
  ThinkingConfigFields,
  useThinkingModelSync,
} from '@/components/profiles/ThinkingConfigFields';
import { normalizeThinkingForModel } from '@/components/shared/model-compatibility';
import { DURATION, EASE, motion } from '@/config/animation';
import { useMcpServers } from '@/shared/hooks/useMcpServers';
import { useSkills } from '@/shared/hooks/useSkills';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { WizardSoulEditor } from './WizardSoulEditor';

interface ConfigureStepProps {
  form: ProfileFormData;
  setForm: (updater: (prev: ProfileFormData) => ProfileFormData) => void;
  providers: ProviderInfo[];
  onBack: () => void;
  onContinue: () => void;
}

export function ConfigureStep({
  form,
  setForm,
  providers,
  onBack,
  onContinue,
}: ConfigureStepProps) {
  const { t } = useLanguage();
  const p = t.profiles;
  const { servers: mcpServers } = useMcpServers();
  const { skills } = useSkills();

  const runtimeOptions = useMemo(
    () =>
      providers.map((pv) => ({
        value: pv.type,
        label: pv.available === false ? `${pv.name} (unavailable)` : pv.name,
        description: pv.description,
      })),
    [providers],
  );

  const modelOptions = useMemo(
    () => getModelsForRuntime(form.runtime_id, providers, p),
    [form.runtime_id, providers, p],
  );

  const selectedProvider = useMemo(
    () => providers.find((pv) => pv.type === form.runtime_id),
    [providers, form.runtime_id],
  );

  const providerCapabilities = useMemo(
    () => getProviderCapabilities(selectedProvider),
    [selectedProvider],
  );

  const handleRuntimeChange = useCallback(
    (runtime_id: string) => {
      setForm((prev) => {
        const models = getModelsForRuntime(runtime_id, providers, p);
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
    [setForm, providers, p],
  );

  const toggleMcp = useCallback(
    (name: string) => {
      setForm((prev) => ({
        ...prev,
        default_mcp_servers: prev.default_mcp_servers.includes(name)
          ? prev.default_mcp_servers.filter((s) => s !== name)
          : [...prev.default_mcp_servers, name],
      }));
    },
    [setForm],
  );

  const toggleSkill = useCallback(
    (slug: string) => {
      setForm((prev) => {
        const current = prev.default_skills ?? [];
        return {
          ...prev,
          default_skills: current.includes(slug)
            ? current.filter((s) => s !== slug)
            : [...current, slug],
        };
      });
    },
    [setForm],
  );

  const canContinue = form.runtime_id.length > 0;

  useThinkingModelSync(form.default_model, setForm);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.moderate, ease: EASE.out }}
        className="text-center"
      >
        <h2 className="text-2xl font-bold tracking-tight">
          {p.quickstartConfigureTitle ?? 'Configure your agent'}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {p.quickstartConfigureSubtitle ??
            'Set up the runtime, tools, and behavior'}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.moderate, ease: EASE.out, delay: 0.1 }}
        className="bg-card border-border w-full space-y-5 rounded-xl border p-6"
      >
        {/* Runtime */}
        <div>
          <label className={LABEL_CLASS}>
            {p.runtime} <span className="text-red-400">*</span>
          </label>
          <Combobox
            value={form.runtime_id}
            onChange={handleRuntimeChange}
            options={runtimeOptions}
            placeholder={p.selectRuntime}
          />

          {/* Availability warning */}
          {selectedProvider?.available === false && (
            <p className="mt-1.5 text-[11px] leading-snug text-yellow-500/80">
              ⚠ Runtime unavailable — install the required CLI or configure an
              API key in Settings.
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
            <label className={LABEL_CLASS}>{p.model}</label>
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
              placeholder={p.model}
            />
          </div>
        )}

        {/* Thinking Config — Claude only */}
        {runtimeSupportsThinking(form.runtime_id) && (
          <ThinkingConfigFields
            form={form}
            setForm={setForm}
            idPrefix="wiz"
            p={p}
          />
        )}

        {/* Soul Editor */}
        <WizardSoulEditor form={form} setForm={setForm} />

        {/* MCP Servers & Skills */}
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

        {/* Max Concurrent Tasks */}
        <div>
          <label className={LABEL_CLASS}>{p.maxConcurrentTasks}</label>
          <input
            type="number"
            min={1}
            max={10}
            value={form.max_concurrent_tasks}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                max_concurrent_tasks: Math.max(
                  1,
                  parseInt(e.target.value, 10) || 1,
                ),
              }))
            }
            className={cn(INPUT_CLASS, 'w-24')}
          />
        </div>
      </motion.div>

      {/* Navigation */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="flex w-full items-center justify-between"
      >
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {p.quickstartBack ?? 'Back'}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          {p.quickstartContinue ?? 'Continue'}
        </button>
      </motion.div>
    </div>
  );
}
