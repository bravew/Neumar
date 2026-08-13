/**
 * Wizard Step 2 — Personalize: name, avatar, role, description, system prompt.
 */

import { useCallback, useMemo } from 'react';

import { AvatarPicker } from '@/components/profiles/AvatarPicker';
import { Combobox } from '@/components/profiles/Combobox';
import {
  getRoleComboOptions,
  INPUT_CLASS,
  LABEL_CLASS,
  ROLE_PRESETS,
} from '@/components/profiles/profile-constants';
import type { ProfileFormData } from '@/components/profiles/ProfileDialog';
import { DURATION, EASE, motion } from '@/config/animation';
import { useLanguage } from '@/shared/providers/language-provider';

interface PersonalizeStepProps {
  form: ProfileFormData;
  setForm: (updater: (prev: ProfileFormData) => ProfileFormData) => void;
  templateName: string;
  onBack: () => void;
  onContinue: () => void;
}

export function PersonalizeStep({
  form,
  setForm,
  templateName,
  onBack,
  onContinue,
}: PersonalizeStepProps) {
  const { t } = useLanguage();
  const p = t.profiles;

  const roleOptions = useMemo(() => getRoleComboOptions(p), [p]);

  const handleRoleChange = useCallback(
    (role: string) => {
      setForm((prev) => {
        const preset = ROLE_PRESETS.find((r) => r.value === role);
        return {
          ...prev,
          role,
          system_prompt: preset?.systemPrompt ?? prev.system_prompt,
        };
      });
    },
    [setForm],
  );

  const canContinue = form.name.trim().length > 0;

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.moderate, ease: EASE.out }}
        className="text-center"
      >
        <h2 className="text-2xl font-bold tracking-tight">
          {p.quickstartPersonalizeTitle ?? 'Personalize your agent'}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {p.quickstartPersonalizeSubtitle ??
            'Tweak the basics — you can fine-tune everything later'}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.moderate, ease: EASE.out, delay: 0.1 }}
        className="bg-card border-border w-full space-y-5 rounded-xl border p-6"
      >
        {/* Avatar */}
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

        {/* Name */}
        <div>
          <label className={LABEL_CLASS}>
            {p.name} <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder={
              templateName || p.quickstartDefaultName || 'Agent name'
            }
            className={INPUT_CLASS}
            autoFocus
          />
        </div>

        {/* Role */}
        <div>
          <label className={LABEL_CLASS}>{p.role}</label>
          <Combobox
            value={form.role}
            onChange={handleRoleChange}
            options={roleOptions}
            placeholder={p.role}
          />
        </div>

        {/* Description */}
        <div>
          <label className={LABEL_CLASS}>{p.description}</label>
          <textarea
            value={form.description}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder={p.description}
            rows={2}
            className={`${INPUT_CLASS} resize-none`}
          />
        </div>

        {/* System Prompt */}
        <div>
          <label className={LABEL_CLASS}>{p.systemPrompt}</label>
          <textarea
            value={form.system_prompt}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, system_prompt: e.target.value }))
            }
            placeholder={p.systemPrompt}
            rows={4}
            className={`${INPUT_CLASS} resize-y font-mono text-xs`}
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
