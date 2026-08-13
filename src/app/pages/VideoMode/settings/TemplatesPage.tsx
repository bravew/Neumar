import { useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Clapperboard, Sparkles } from 'lucide-react';

import { TemplateUseForm } from '@/components/video/TemplateUseForm';
import {
  createVideoProjectFromTemplate,
  useVideoTemplates,
} from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoTemplate,
  VideoTemplateCategory,
  VideoTemplatePace,
} from '@/shared/types/video';

import { VideoSettingsShell } from './VideoSettingsShell';

const CATEGORY_FILTERS: Array<VideoTemplateCategory | 'all'> = [
  'all',
  'shorts',
  'explainer',
  'ad',
  'tutorial',
  'product',
  'podcast',
  'testimonial',
  'recap',
  'announcement',
  'other',
  'custom',
];
const ASPECT_FILTERS: Array<VideoAspectRatio | 'all'> = [
  'all',
  '16:9',
  '9:16',
  '1:1',
  '4:5',
];
const PACE_FILTERS: Array<VideoTemplatePace | 'all'> = [
  'all',
  'slow',
  'medium',
  'fast',
  'extreme',
];

export function VideoTemplatesSettingsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { templates, loading, error } = useVideoTemplates();
  const [category, setCategory] = useState<VideoTemplateCategory | 'all'>(
    'all',
  );
  const [aspect, setAspect] = useState<VideoAspectRatio | 'all'>('all');
  const [pace, setPace] = useState<VideoTemplatePace | 'all'>('all');
  const [selected, setSelected] = useState<VideoTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () =>
      templates.filter((template) => {
        if (category !== 'all' && template.category !== category) return false;
        if (aspect !== 'all' && !template.aspectRatios.includes(aspect)) {
          return false;
        }
        if (pace !== 'all' && template.pace !== pace) return false;
        return true;
      }),
    [aspect, category, pace, templates],
  );

  const handleTemplateUse = async (
    template: VideoTemplate,
    inputs: Record<string, unknown>,
  ) => {
    setBusy(true);
    try {
      const result = await createVideoProjectFromTemplate({
        templateId: template.id,
        inputs,
        name: template.displayName,
      });
      navigate(`/video/${result.project.id}?step=board`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <VideoSettingsShell
      title={t.video.settings.templates.title}
      description={t.video.settings.templates.description}
    >
      <div className="space-y-4">
        <div className="border-border bg-background flex flex-wrap gap-2 rounded-md border p-3">
          <FilterSelect
            label={t.video.templates.library.browse}
            value={category}
            values={CATEGORY_FILTERS}
            getLabel={(value) =>
              value === 'all'
                ? t.video.templates.library.all
                : t.video.templates.category[value]
            }
            onChange={(value) =>
              setCategory(value as VideoTemplateCategory | 'all')
            }
          />
          <FilterSelect
            label={t.video.templates.library.aspect}
            value={aspect}
            values={ASPECT_FILTERS}
            getLabel={(value) =>
              value === 'all' ? t.video.templates.library.all : value
            }
            onChange={(value) => setAspect(value as VideoAspectRatio | 'all')}
          />
          <FilterSelect
            label={t.video.templates.library.pace}
            value={pace}
            values={PACE_FILTERS}
            getLabel={(value) =>
              value === 'all'
                ? t.video.templates.library.all
                : t.video.templates.pace[value]
            }
            onChange={(value) => setPace(value as VideoTemplatePace | 'all')}
          />
        </div>
        {loading ? (
          <p className="text-muted-foreground text-sm">
            {t.video.templates.library.loading}
          </p>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          <div className="grid max-w-6xl gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((template) => (
              <button
                type="button"
                key={template.id}
                className="border-border hover:bg-accent/60 bg-background rounded-md border p-4 text-left"
                onClick={() => setSelected(template)}
              >
                <div className="bg-muted text-muted-foreground flex aspect-video items-center justify-center rounded-md">
                  {template.thumbnailUrl ? (
                    <img
                      src={template.thumbnailUrl}
                      alt=""
                      className="size-full rounded-md object-cover"
                    />
                  ) : (
                    <Clapperboard className="size-6" />
                  )}
                </div>
                <h2 className="text-foreground mt-3 text-sm font-semibold">
                  {template.displayName}
                </h2>
                <p className="text-muted-foreground mt-1 text-xs">
                  {template.durationSec.typical}s ·{' '}
                  {template.aspectRatios.join(', ')} ·{' '}
                  {t.video.templates.pace[template.pace]}
                </p>
              </button>
            ))}
          </div>
        )}
        {selected ? (
          <section className="border-border bg-background max-w-3xl rounded-md border p-4">
            <div className="mb-4 flex items-start gap-3">
              <Sparkles className="text-muted-foreground mt-0.5 size-4" />
              <div>
                <h2 className="text-foreground text-sm font-semibold">
                  {selected.displayName}
                </h2>
                <p className="text-muted-foreground text-xs">
                  {t.video.templates.detail.durationTypical.replace(
                    '{seconds}',
                    String(selected.durationSec.typical),
                  )}
                </p>
              </div>
            </div>
            <TemplateUseForm
              key={selected.id}
              template={selected}
              busy={busy}
              onUse={(inputs) => handleTemplateUse(selected, inputs)}
            />
          </section>
        ) : null}
      </div>
    </VideoSettingsShell>
  );
}

function FilterSelect<TValue extends string>({
  label,
  value,
  values,
  getLabel,
  onChange,
}: {
  label: string;
  value: TValue;
  values: TValue[];
  getLabel: (value: TValue) => string;
  onChange: (value: TValue) => void;
}) {
  return (
    <label className="text-muted-foreground flex items-center gap-2 text-xs">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as TValue)}
        className="border-input bg-background text-foreground rounded-md border px-2 py-1"
      >
        {values.map((option) => (
          <option key={option} value={option}>
            {getLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
