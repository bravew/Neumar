import { useMemo, useState, type ReactNode } from 'react';

import { CronExpressionInput } from '@/components/automation/CronExpressionInput';
import { createDesignRoutine } from '@/shared/hooks/useDesignMode';
import { formatDesignRoutineScheduleSummary } from '@/shared/lib/schedule-summary';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignProject,
  DesignRoutine,
  DesignRoutineSchedule,
  DesignSurface,
  DesignSkillRecord,
  DesignSystemRecord,
} from '@/shared/types/design-mode';

import { scheduleFromCron } from './routineScheduleForm';

const SURFACES: DesignSurface[] = [
  'prototype',
  'document',
  'image',
  'video',
  'audio',
  'deck',
  'campaign',
];

export function RoutineForm({
  projects,
  designSystems,
  skills,
  onCreated,
  onOpen,
}: {
  projects: DesignProject[];
  designSystems: DesignSystemRecord[];
  skills: DesignSkillRecord[];
  onCreated: (routine: DesignRoutine) => Promise<void>;
  onOpen: (project: DesignProject) => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    name: '',
    prompt: '',
    surface: 'prototype' as DesignSurface,
    targetMode: 'new_project' as DesignRoutine['targetMode'],
    projectId: '',
    designSystemId: '',
    skillId: '',
    enabled: true,
    scheduleEnabled: false,
    cronExpr: '0 9 * * *',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === form.projectId),
    [form.projectId, projects],
  );
  const schedulePreview = form.scheduleEnabled
    ? scheduleFromCron(form.cronExpr, form.timezone)
    : null;
  const scheduleSummary = schedulePreview
    ? formatDesignRoutineScheduleSummary(
        schedulePreview,
        t.automation.scheduleSummary,
      )
    : null;

  const createRoutine = async () => {
    setFormError('');
    const schedule = form.scheduleEnabled
      ? scheduleFromCron(form.cronExpr, form.timezone)
      : ({ kind: 'manual' } satisfies DesignRoutineSchedule);
    if (!form.name.trim() || !form.prompt.trim()) {
      setFormError(t.design.routines.validationRequired);
      return;
    }
    if (form.targetMode === 'existing_project' && !form.projectId) {
      setFormError(t.design.routines.validationProjectRequired);
      return;
    }
    if (!schedule) {
      setFormError(t.design.routines.validationScheduleUnsupported);
      return;
    }
    setCreating(true);
    try {
      const { routine } = await createDesignRoutine({
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        surface: form.surface,
        targetMode: form.targetMode,
        projectId:
          form.targetMode === 'existing_project' ? form.projectId : null,
        enabled: form.enabled,
        designSystemId: form.designSystemId || null,
        skillId: form.skillId || null,
        schedule,
      });
      setForm((prev) => ({ ...prev, name: '', prompt: '' }));
      await onCreated(routine);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t.design.routines.title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t.design.routines.description}
        </p>
      </div>
      <Field label={t.design.routines.name}>
        <input
          value={form.name}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, name: event.target.value }))
          }
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
        />
      </Field>
      <Field label={t.design.prompt}>
        <textarea
          value={form.prompt}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, prompt: event.target.value }))
          }
          rows={5}
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        />
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField
          label={t.design.surfaceLabel}
          value={form.surface}
          onChange={(surface) =>
            setForm((prev) => ({ ...prev, surface: surface as DesignSurface }))
          }
          options={SURFACES.map((surface) => ({
            value: surface,
            label: t.design.surfaces[surface],
          }))}
        />
        <SelectField
          label={t.design.routines.target}
          value={form.targetMode}
          onChange={(targetMode) =>
            setForm((prev) => ({
              ...prev,
              targetMode: targetMode as DesignRoutine['targetMode'],
            }))
          }
          options={[
            {
              value: 'new_project',
              label: t.design.routines.targetNewProject,
            },
            {
              value: 'existing_project',
              label: t.design.routines.targetExistingProject,
            },
          ]}
        />
      </div>
      {form.targetMode === 'existing_project' && (
        <SelectField
          label={t.design.routines.project}
          value={form.projectId}
          onChange={(projectId) => setForm((prev) => ({ ...prev, projectId }))}
          options={[
            { value: '', label: t.design.routines.chooseProject },
            ...projects.map((project) => ({
              value: project.id,
              label: project.title,
            })),
          ]}
        />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField
          label={t.design.designSystem}
          value={form.designSystemId}
          onChange={(designSystemId) =>
            setForm((prev) => ({ ...prev, designSystemId }))
          }
          options={[
            { value: '', label: t.design.routines.defaultProjectSetting },
            ...designSystems.map((system) => ({
              value: system.id,
              label: system.title,
            })),
          ]}
        />
        <SelectField
          label={t.design.defaultSkill}
          value={form.skillId}
          onChange={(skillId) => setForm((prev) => ({ ...prev, skillId }))}
          options={[
            { value: '', label: t.design.routines.defaultProjectSetting },
            ...skills.map((skill) => ({ value: skill.id, label: skill.name })),
          ]}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.scheduleEnabled}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              scheduleEnabled: event.target.checked,
            }))
          }
        />
        {t.design.routines.scheduleEnabled}
      </label>
      {form.scheduleEnabled && (
        <div className="space-y-3">
          <CronExpressionInput
            value={form.cronExpr}
            onChange={(cronExpr) => setForm((prev) => ({ ...prev, cronExpr }))}
          />
          {scheduleSummary && (
            <div className="bg-muted text-muted-foreground inline-flex rounded-full px-2.5 py-1 text-xs">
              {scheduleSummary}
            </div>
          )}
          <Field label={t.design.routines.timezone}>
            <input
              value={form.timezone}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, timezone: event.target.value }))
              }
              className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            />
          </Field>
        </div>
      )}
      {formError && <p className="text-destructive text-sm">{formError}</p>}
      <button
        type="button"
        onClick={() => void createRoutine()}
        disabled={creating}
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
      >
        {creating ? t.design.routines.creating : t.design.routines.create}
      </button>
      {selectedProject && (
        <button
          type="button"
          onClick={() => onOpen(selectedProject)}
          className="text-primary ml-3 text-sm hover:underline"
        >
          {t.design.routines.openSelectedProject}
        </button>
      )}
    </section>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-background h-10 rounded-md border px-3 text-sm"
      >
        {options.map((option) => (
          <option key={option.value || option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
