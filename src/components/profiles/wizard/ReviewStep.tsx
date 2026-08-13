/**
 * Wizard Step 4 — Review summary with soul preview + create.
 */

import {
  Brain,
  Fingerprint,
  Loader2,
  MessageSquare,
  Pencil,
  Shield,
  Sparkles,
} from 'lucide-react';

import { AvatarSvg } from '@/components/profiles/avatar-options';
import type { ProviderInfo } from '@/components/profiles/profile-constants';
import { DURATION, EASE, motion, SPRING } from '@/config/animation';
import { useLanguage } from '@/shared/providers/language-provider';

import type { WizardData } from './ProfileWizard';

interface ReviewStepProps {
  data: WizardData;
  providers: ProviderInfo[];
  creating: boolean;
  error: string | null;
  onBack: () => void;
  onCreate: () => void;
  onJumpToStep: (step: number) => void;
}

export function ReviewStep({
  data,
  providers,
  creating,
  error,
  onBack,
  onCreate,
  onJumpToStep,
}: ReviewStepProps) {
  const { t } = useLanguage();
  const p = t.profiles;
  const { form, template } = data;

  const runtimeLabel =
    providers.find((pv) => pv.type === form.runtime_id)?.name ??
    form.runtime_id;
  const skillCount = form.default_skills?.length ?? 0;
  const mcpCount = form.default_mcp_servers.length;
  const isCustom = !template || template.id === 'custom';

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.moderate, ease: EASE.out }}
        className="text-center"
      >
        <h2 className="text-2xl font-bold tracking-tight">
          {p.quickstartConfirmTitle ?? 'Your agent is ready!'}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {(
            p.quickstartConfirmSummary ??
            '{name} is set up with {skillCount} skills and ready to chat'
          )
            .replace('{name}', form.name || p.quickstartDefaultName || 'Agent')
            .replace('{skillCount}', String(skillCount))}
        </p>
      </motion.div>

      {/* ── Profile summary card ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...SPRING.gentle, delay: 0.1 }}
        className="bg-card border-border w-full overflow-hidden rounded-xl border"
      >
        {/* Header */}
        <div className="flex items-center gap-4 p-6 pb-4">
          <AvatarSvg
            avatarId={form.avatar_icon}
            color={form.avatar_color}
            className="size-14 shrink-0 overflow-hidden rounded-xl shadow-sm"
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-foreground truncate text-lg font-semibold">
              {form.name || p.quickstartDefaultName || 'Agent'}
            </h3>
            {form.role && (
              <p className="text-muted-foreground truncate text-sm">
                {form.role}
              </p>
            )}
          </div>
          {!isCustom && (
            <span className="bg-primary/10 text-primary flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium">
              <Sparkles className="size-3" />
              {template!.name}
            </span>
          )}
          <button
            type="button"
            onClick={() => onJumpToStep(1)}
            className="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
            title={p.editProfile}
          >
            <Pencil className="size-3.5" />
          </button>
        </div>

        {/* Basic details */}
        <div className="border-border space-y-2.5 border-t px-6 py-4">
          {form.description && (
            <ReviewRow label={p.description} value={form.description} />
          )}
          <ReviewRow label={p.runtime} value={runtimeLabel} />
          {form.default_model && (
            <ReviewRow label={p.model} value={form.default_model} />
          )}
          {form.thinking_config && (
            <ReviewRow
              label={p.thinkingConfig}
              value={formatThinking(form.thinking_config, p)}
            />
          )}
          {form.system_prompt && (
            <ReviewRow
              label={p.systemPrompt}
              value={
                form.system_prompt.length > 120
                  ? form.system_prompt.slice(0, 120) + '…'
                  : form.system_prompt
              }
            />
          )}
        </div>

        {/* Tools summary */}
        {(skillCount > 0 || mcpCount > 0) && (
          <div className="border-border flex items-center justify-between border-t px-6 py-3">
            <div className="flex gap-4 text-xs">
              {skillCount > 0 && (
                <span className="text-muted-foreground">
                  {skillCount}{' '}
                  {skillCount === 1
                    ? (p.quickstartSkillSingular ?? 'skill')
                    : (p.quickstartSkillPlural ?? 'skills')}
                </span>
              )}
              {mcpCount > 0 && (
                <span className="text-muted-foreground">
                  {mcpCount} {p.mcpServers?.toLowerCase() ?? 'MCP servers'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onJumpToStep(2)}
              className="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
              title={p.editProfile}
            >
              <Pencil className="size-3.5" />
            </button>
          </div>
        )}
      </motion.div>

      {/* ── Soul summary ────────────────────────────────────────────────── */}
      {form.soul && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          className="bg-card border-border w-full rounded-xl border"
        >
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="text-primary size-4" />
              <span className="text-sm font-semibold">
                {p.soulEditor}
                {!isCustom && ` — ${template!.name}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onJumpToStep(2)}
              className="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
              title={p.editSoul}
            >
              <Pencil className="size-3.5" />
            </button>
          </div>

          <div className="border-border grid grid-cols-1 gap-px border-t sm:grid-cols-2">
            {/* Identity */}
            <SoulSection
              icon={Fingerprint}
              label={p.soulIdentity}
              items={[
                { k: p.soulRole, v: form.soul!.identity.role },
                {
                  k: p.soulCoreValues,
                  v: form.soul!.identity.core_values?.join(', '),
                },
                ...(form.soul!.identity.worldview
                  ? [{ k: p.soulWorldview, v: form.soul!.identity.worldview }]
                  : []),
              ]}
            />

            {/* Voice */}
            <SoulSection
              icon={MessageSquare}
              label={p.soulVoice}
              items={[
                { k: p.soulTone, v: form.soul!.voice.tone },
                {
                  k: p.soulStyleRules,
                  v: form.soul!.voice.style_rules?.join(', '),
                },
                ...(form.soul!.voice.greeting
                  ? [{ k: p.soulGreeting, v: form.soul!.voice.greeting }]
                  : []),
              ]}
            />

            {/* Cognition */}
            <SoulSection
              icon={Brain}
              label={p.soulCognition}
              items={[
                {
                  k: p.soulReasoningStyle,
                  v: form.soul!.cognition.reasoning_style,
                },
                ...(form.soul!.cognition.expertise?.length
                  ? [
                      {
                        k: p.soulExpertise,
                        v: form.soul!.cognition.expertise.join(', '),
                      },
                    ]
                  : []),
              ]}
            />

            {/* Boundaries */}
            <SoulSection
              icon={Shield}
              label={p.soulBoundaries}
              items={[
                {
                  k: p.soulRedLines,
                  v: form.soul!.boundaries.red_lines?.join(', '),
                },
                ...(form.soul!.boundaries.escalation_rules?.length
                  ? [
                      {
                        k: p.soulEscalation,
                        v: form.soul!.boundaries.escalation_rules.join(', '),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </motion.div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <p className="w-full rounded-lg bg-red-500/10 px-4 py-2 text-center text-sm text-red-400">
          {error}
        </p>
      )}

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.3 }}
        className="flex w-full items-center justify-between"
      >
        <button
          type="button"
          onClick={onBack}
          disabled={creating}
          className="text-muted-foreground hover:text-foreground rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {p.quickstartBack ?? 'Back'}
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          {creating && <Loader2 className="size-4 animate-spin" />}
          {p.createProfile ?? 'Create Profile'}
        </button>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.3 }}
        className="text-muted-foreground/60 text-center text-xs"
      >
        {p.quickstartCustomizeFurther ?? 'Customize further in Settings'}
      </motion.p>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-muted-foreground w-24 shrink-0 text-xs font-medium">
        {label}
      </span>
      <span className="text-foreground text-sm">{value}</span>
    </div>
  );
}

function SoulSection({
  icon: Icon,
  label,
  items,
}: {
  icon: typeof Fingerprint;
  label: string;
  items: Array<{ k: string; v?: string }>;
}) {
  const filtered = items.filter((i) => i.v);
  if (filtered.length === 0) return null;

  return (
    <div className="border-border space-y-1.5 border-r border-b p-4 last:border-r-0">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
        <Icon className="size-3.5" />
        {label}
      </div>
      {filtered.map(({ k, v }) => (
        <div key={k} className="text-xs">
          <span className="text-foreground/60 font-medium">{k}: </span>
          <span className="text-foreground/80">
            {v && v.length > 100 ? v.slice(0, 100) + '…' : v}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatThinking(
  tc: { type: string; effort?: string; budgetTokens?: number },
  p: Record<string, string>,
): string {
  if (tc.type === 'adaptive') return `${p.thinkingAdaptive} (${tc.effort})`;
  if (tc.type === 'enabled') return `${p.thinkingEnabled} (${tc.budgetTokens})`;
  return p.thinkingDisabled;
}
