import { useCallback, useMemo, useState } from 'react';

import {
  Copy,
  ExternalLink,
  Loader2,
  Search,
  Share2,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getDesignSkillExample } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSkillRecord } from '@/shared/types/design-mode';

import { localizedSurfaceLabel } from '../constants';

type SurfaceFilter = 'all' | 'web' | 'image' | 'video' | 'audio';
type ModeFilter =
  | 'all'
  | 'prototype-desktop'
  | 'prototype-mobile'
  | 'deck'
  | 'document';

interface PreviewState {
  html: string | null;
  loading: boolean;
}

const SURFACE_FILTERS: SurfaceFilter[] = [
  'all',
  'web',
  'image',
  'video',
  'audio',
];

const MODE_FILTERS: ModeFilter[] = [
  'all',
  'prototype-desktop',
  'prototype-mobile',
  'deck',
  'document',
];

const SCENARIO_ORDER = [
  'engineering',
  'product',
  'design',
  'marketing',
  'sales',
  'finance',
  'hr',
  'operations',
  'support',
  'legal',
  'education',
  'personal',
  'planning',
  'video',
  'general',
];

export function ExamplesTab({
  skills,
  onUsePrompt,
}: {
  skills: DesignSkillRecord[];
  onUsePrompt: (skill: DesignSkillRecord) => Promise<void>;
}) {
  const { t, tt } = useLanguage();
  const [query, setQuery] = useState('');
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [scenarioFilter, setScenarioFilter] = useState('all');
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<DesignSkillRecord | null>(
    null,
  );
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [error, setError] = useState('');

  const loadPreview = useCallback(
    async (skill: DesignSkillRecord) => {
      if (previews[skill.id]) return;
      setPreviews((prev) => ({
        ...prev,
        [skill.id]: { html: null, loading: true },
      }));

      const html = await getDesignSkillExample(skill.id);
      setPreviews((prev) => ({
        ...prev,
        [skill.id]: { html, loading: false },
      }));
    },
    [previews],
  );

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((skill) =>
      [
        skill.name,
        skill.description,
        skill.od.surface,
        skill.od.mode,
        skill.od.scenario,
        examplePrompt(skill),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q)),
    );
  }, [query, skills]);

  const surfaceCounts = useMemo(() => {
    const counts: Record<SurfaceFilter, number> = {
      all: searched.length,
      web: 0,
      image: 0,
      video: 0,
      audio: 0,
    };
    for (const skill of searched) counts[surfaceOf(skill)]++;
    return counts;
  }, [searched]);

  const modeCounts = useMemo(() => {
    const surfaceScoped = searched.filter((skill) =>
      matchesSurface(skill, surfaceFilter),
    );
    const counts: Record<ModeFilter, number> = {
      all: surfaceScoped.length,
      'prototype-desktop': 0,
      'prototype-mobile': 0,
      deck: 0,
      document: 0,
    };
    for (const skill of surfaceScoped) {
      for (const mode of MODE_FILTERS) {
        if (mode !== 'all' && matchesMode(skill, mode)) counts[mode]++;
      }
    }
    return counts;
  }, [searched, surfaceFilter]);

  const scenarioCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of searched) {
      if (!matchesSurface(skill, surfaceFilter)) continue;
      if (!matchesMode(skill, modeFilter)) continue;
      const scenario = skill.od.scenario || 'general';
      counts.set(scenario, (counts.get(scenario) ?? 0) + 1);
    }
    return counts;
  }, [modeFilter, searched, surfaceFilter]);

  const scenarioOptions = useMemo(() => {
    const available = new Set(scenarioCounts.keys());
    const ordered: string[] = [];
    for (const scenario of SCENARIO_ORDER) {
      if (available.has(scenario)) ordered.push(scenario);
    }
    for (const scenario of [...available].sort()) {
      if (!ordered.includes(scenario)) ordered.push(scenario);
    }
    return ordered;
  }, [scenarioCounts]);

  const filtered = useMemo(() => {
    return searched
      .filter((skill) => {
        if (!matchesSurface(skill, surfaceFilter)) return false;
        if (!matchesMode(skill, modeFilter)) return false;
        if (scenarioFilter === 'all') return true;
        return (skill.od.scenario || 'general') === scenarioFilter;
      })
      .map((skill, index) => ({ skill, index }))
      .sort((a, b) => {
        const aRank =
          typeof a.skill.od.featured === 'number'
            ? a.skill.od.featured
            : Number.POSITIVE_INFINITY;
        const bRank =
          typeof b.skill.od.featured === 'number'
            ? b.skill.od.featured
            : Number.POSITIVE_INFINITY;
        if (aRank !== bRank) return aRank - bRank;
        return a.index - b.index;
      })
      .map(({ skill }) => skill);
  }, [modeFilter, scenarioFilter, searched, surfaceFilter]);

  const handleUsePrompt = async (skill: DesignSkillRecord) => {
    setCreatingId(skill.id);
    setError('');
    try {
      await onUsePrompt(skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreatingId(null);
    }
  };

  const openPreview = (skill: DesignSkillRecord) => {
    setPreviewSkill(skill);
    void loadPreview(skill);
  };

  if (skills.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{t.design.noExamples}</p>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <label className="border-input flex h-10 min-w-64 items-center gap-2 rounded-md border px-3">
          <Search className="text-muted-foreground size-4" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setScenarioFilter('all');
            }}
            placeholder={t.design.searchExamples}
            aria-label={t.design.searchExamples}
            data-testid="examples-search"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <span className="text-muted-foreground shrink-0 text-xs">
            {filtered.length} / {skills.length}
          </span>
        </label>

        <div className="space-y-2">
          <FilterChipGroup
            label={tt('design.exampleSurfaceLabel')}
            options={SURFACE_FILTERS.map((value) => ({
              value,
              label: surfaceFilterLabel(value, t, tt),
              count: surfaceCounts[value],
            }))}
            value={surfaceFilter}
            onChange={(value) => {
              setSurfaceFilter(value as SurfaceFilter);
              setModeFilter('all');
              setScenarioFilter('all');
            }}
            testIdPrefix="examples-surface-filter"
          />
          <FilterChipGroup
            label={tt('design.exampleTypeLabel')}
            options={MODE_FILTERS.map((value) => ({
              value,
              label: modeFilterLabel(value, tt),
              count: modeCounts[value],
            }))}
            value={modeFilter}
            onChange={(value) => {
              setModeFilter(value as ModeFilter);
              setScenarioFilter('all');
            }}
            testIdPrefix="examples-type-filter"
          />
          {scenarioOptions.length > 1 && (
            <FilterChipGroup
              label={t.design.scenarioFilter}
              options={[
                {
                  value: 'all',
                  label: tt('design.exampleAll'),
                  count: [...scenarioCounts.values()].reduce(
                    (sum, count) => sum + count,
                    0,
                  ),
                },
                ...scenarioOptions.map((value) => ({
                  value,
                  label: scenarioLabel(value, tt),
                  count: scenarioCounts.get(value) ?? 0,
                })),
              ]}
              value={scenarioFilter}
              onChange={setScenarioFilter}
              testIdPrefix="examples-scenario-filter"
            />
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.design.noMatches}</p>
        ) : (
          <div className="space-y-5">
            {filtered.map((skill) => (
              <ExampleCard
                key={skill.id}
                skill={skill}
                preview={previews[skill.id]}
                creating={creatingId === skill.id}
                onLoadPreview={() => void loadPreview(skill)}
                onOpenPreview={() => openPreview(skill)}
                onUsePrompt={() => void handleUsePrompt(skill)}
              />
            ))}
          </div>
        )}
      </div>
      <ExamplePreviewDialog
        skill={previewSkill}
        preview={previewSkill ? previews[previewSkill.id] : undefined}
        creating={Boolean(previewSkill && creatingId === previewSkill.id)}
        error={error}
        onOpenChange={(open) => {
          if (!open) setPreviewSkill(null);
        }}
        onUsePrompt={(skill) => void handleUsePrompt(skill)}
      />
    </>
  );
}

function FilterChipGroup({
  label,
  options,
  value,
  onChange,
  testIdPrefix,
}: {
  label: string;
  options: Array<{ value: string; label: string; count: number }>;
  value: string;
  onChange: (value: string) => void;
  testIdPrefix: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="tablist"
      aria-label={label}
    >
      <span className="text-muted-foreground min-w-20 text-xs font-medium">
        {label}
      </span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          data-testid={`${testIdPrefix}-${option.value}`}
          className="border-border bg-background text-foreground hover:border-primary/40 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs transition-colors"
          data-active={value === option.value}
          onClick={() => onChange(option.value)}
        >
          <span>{option.label}</span>
          <span
            className="bg-muted text-muted-foreground data-[active=true]:bg-primary-foreground/20 data-[active=true]:text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px]"
            data-active={value === option.value}
          >
            {option.count}
          </span>
        </button>
      ))}
    </div>
  );
}

function ExampleCard({
  skill,
  preview,
  creating,
  onLoadPreview,
  onOpenPreview,
  onUsePrompt,
}: {
  skill: DesignSkillRecord;
  preview: PreviewState | undefined;
  creating: boolean;
  onLoadPreview: () => void;
  onOpenPreview: () => void;
  onUsePrompt: () => void;
}) {
  const { t, tt } = useLanguage();
  const prompt = examplePrompt(skill);

  return (
    <article
      className="border-border bg-card grid overflow-hidden rounded-md border lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"
      data-testid={`example-card-${skill.id}`}
    >
      <button
        type="button"
        className="bg-muted/30 group relative min-h-72 overflow-hidden text-sm"
        onClick={onOpenPreview}
        onFocus={onLoadPreview}
        onMouseEnter={onLoadPreview}
        data-testid={`example-preview-${skill.id}`}
      >
        {preview?.html ? (
          <>
            <iframe
              title={`${skill.name} ${t.design.previewModes.preview}`}
              sandbox="allow-scripts allow-downloads"
              srcDoc={preview.html}
              tabIndex={-1}
              className="pointer-events-none h-full min-h-72 w-full border-0 bg-white"
            />
            <span className="bg-background/90 text-foreground border-border absolute inset-x-4 bottom-4 translate-y-2 rounded-md border px-3 py-2 opacity-0 shadow-sm transition group-hover:translate-y-0 group-hover:opacity-100">
              {tt('design.exampleOpenPreview')}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground flex h-full min-h-72 items-center justify-center gap-2">
            {preview?.loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {tt('design.exampleLoadingPreview')}
              </>
            ) : (
              tt('design.exampleHoverPreview')
            )}
          </span>
        )}
      </button>

      <div className="flex min-h-72 flex-col justify-center p-6">
        <h3 className="text-xl font-semibold tracking-normal">{skill.name}</h3>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="bg-muted rounded-full px-2.5 py-1">
            {tagForSkill(skill, t, tt)}
          </span>
          {skill.od.scenario && (
            <span className="bg-muted rounded-full px-2.5 py-1">
              {scenarioLabel(skill.od.scenario, tt)}
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-5 line-clamp-3 text-sm">
          {skill.description}
        </p>
        <p className="mt-4 line-clamp-3 text-sm leading-6">"{prompt}"</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onUsePrompt}
            disabled={creating}
            data-testid={`example-use-prompt-${skill.id}`}
          >
            <Sparkles className="size-4" />
            {creating ? t.design.creating : t.design.usePrompt}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenPreview}
          >
            <ExternalLink className="size-4" />
            {tt('design.exampleOpenPreview')}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled>
            <Share2 className="size-4" />
            {t.design.share}
          </Button>
        </div>
      </div>
    </article>
  );
}

function ExamplePreviewDialog({
  skill,
  preview,
  creating,
  error,
  onOpenChange,
  onUsePrompt,
}: {
  skill: DesignSkillRecord | null;
  preview: PreviewState | undefined;
  creating: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onUsePrompt: (skill: DesignSkillRecord) => void;
}) {
  const { t, tt } = useLanguage();
  const prompt = skill ? examplePrompt(skill) : '';

  const copyPrompt = () => {
    if (!prompt) return;
    navigator.clipboard?.writeText(prompt).catch(() => {});
  };

  return (
    <Dialog open={Boolean(skill)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-[min(1120px,calc(100vw-2rem))]">
        {skill && (
          <>
            <DialogHeader>
              <DialogTitle>{skill.name}</DialogTitle>
              <DialogDescription>{skill.description}</DialogDescription>
            </DialogHeader>
            <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="bg-muted min-h-[360px] overflow-hidden rounded-md border">
                {preview?.html ? (
                  <iframe
                    title={`${skill.name} ${t.design.previewModes.preview}`}
                    sandbox="allow-scripts allow-downloads"
                    srcDoc={preview.html}
                    className="h-[60vh] min-h-[360px] w-full border-0 bg-white"
                  />
                ) : (
                  <div className="text-muted-foreground flex h-[60vh] min-h-[360px] items-center justify-center gap-2 text-sm">
                    {preview?.loading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {tt('design.exampleLoadingPreview')}
                      </>
                    ) : (
                      t.design.noPreview
                    )}
                  </div>
                )}
              </div>
              <aside className="min-h-0 space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="bg-muted rounded-full px-2.5 py-1">
                    {tagForSkill(skill, t, tt)}
                  </span>
                  {skill.od.scenario && (
                    <span className="bg-muted rounded-full px-2.5 py-1">
                      {scenarioLabel(skill.od.scenario, tt)}
                    </span>
                  )}
                </div>
                <section className="rounded-md border">
                  <div className="border-b px-3 py-2 text-sm font-medium">
                    {t.design.examplePrompt}
                  </div>
                  <pre className="text-muted-foreground max-h-64 overflow-auto p-3 text-sm whitespace-pre-wrap">
                    {prompt}
                  </pre>
                </section>
                {error && <p className="text-destructive text-sm">{error}</p>}
              </aside>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={copyPrompt}>
                <Copy className="size-4" />
                {t.design.copy}
              </Button>
              <Button
                type="button"
                onClick={() => onUsePrompt(skill)}
                disabled={creating}
              >
                <Sparkles className="size-4" />
                {creating ? t.design.creating : t.design.usePrompt}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function examplePrompt(skill: DesignSkillRecord) {
  return skill.od.examplePrompt || skill.description;
}

function surfaceOf(skill: DesignSkillRecord): SurfaceFilter {
  if (
    skill.od.surface === 'image' ||
    skill.od.surface === 'video' ||
    skill.od.surface === 'audio'
  ) {
    return skill.od.surface;
  }
  return 'web';
}

function matchesSurface(skill: DesignSkillRecord, filter: SurfaceFilter) {
  return filter === 'all' || surfaceOf(skill) === filter;
}

function matchesMode(skill: DesignSkillRecord, filter: ModeFilter) {
  if (filter === 'all') return true;
  const mode = skill.od.mode || skill.od.surface;
  if (filter === 'deck') return mode === 'deck' || skill.od.surface === 'deck';
  if (filter === 'prototype-mobile') {
    return mode === 'prototype' && skill.od.platform === 'mobile';
  }
  if (filter === 'prototype-desktop') {
    return mode === 'prototype' && skill.od.platform !== 'mobile';
  }
  return (
    mode === 'template' ||
    skill.od.surface === 'template' ||
    skill.od.surface === 'document' ||
    skill.od.surface === 'campaign'
  );
}

function surfaceFilterLabel(
  value: SurfaceFilter,
  t: ReturnType<typeof useLanguage>['t'],
  tt: ReturnType<typeof useLanguage>['tt'],
) {
  if (value === 'all') return tt('design.exampleAll');
  if (value === 'web') return tt('design.exampleSurfaceWeb');
  return localizedSurfaceLabel(value, t.design.surfaces);
}

function modeFilterLabel(
  value: ModeFilter,
  tt: ReturnType<typeof useLanguage>['tt'],
) {
  if (value === 'all') return tt('design.exampleAll');
  if (value === 'prototype-desktop') {
    return tt('design.exampleModePrototypeDesktop');
  }
  if (value === 'prototype-mobile') {
    return tt('design.exampleModePrototypeMobile');
  }
  if (value === 'deck') return tt('design.exampleModeDeck');
  return tt('design.exampleModeDocument');
}

function scenarioLabel(
  value: string,
  tt: ReturnType<typeof useLanguage>['tt'],
) {
  const key = `design.exampleScenarios.${value}`;
  const localized = tt(key);
  if (localized !== key) return localized;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function tagForSkill(
  skill: DesignSkillRecord,
  t: ReturnType<typeof useLanguage>['t'],
  tt: ReturnType<typeof useLanguage>['tt'],
) {
  if (skill.od.surface === 'image') {
    return localizedSurfaceLabel('image', t.design.surfaces);
  }
  if (skill.od.surface === 'video') {
    return localizedSurfaceLabel('video', t.design.surfaces);
  }
  if (skill.od.surface === 'audio') {
    return localizedSurfaceLabel('audio', t.design.surfaces);
  }
  if (skill.od.surface === 'deck' || skill.od.mode === 'deck') {
    return tt('design.exampleModeDeck');
  }
  if (skill.od.mode === 'design-system') return t.design.designSystem;
  if (skill.od.platform === 'mobile') {
    return tt('design.exampleTagMobilePrototype');
  }
  if (skill.od.surface === 'template') return t.design.surfaces.template;
  return tt('design.exampleTagDesktopPrototype');
}
