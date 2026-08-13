import { useMemo, useState } from 'react';

import { GalleryFilters } from '@/components/design/GalleryFilters';
import { SkillSourceModal } from '@/components/design/SkillSourceModal';
import { Button } from '@/components/ui/button';
import {
  installDesignSkillCatalogPack,
  uninstallDesignSkillCatalogPack,
} from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSkillRecord } from '@/shared/types/design-mode';

import { localizedSurfaceLabel, surfaceLabel } from '../constants';

export function SkillsTab({
  skills,
  selectedId,
  onCreate,
  onSelectDefault,
  onCatalogChanged,
}: {
  skills: DesignSkillRecord[];
  selectedId?: string;
  onCreate: (skill: DesignSkillRecord) => Promise<void>;
  onSelectDefault: (skill: DesignSkillRecord) => void;
  onCatalogChanged: () => void;
}) {
  const { t } = useLanguage();
  const [previewSkill, setPreviewSkill] = useState<DesignSkillRecord | null>(
    null,
  );
  const [query, setQuery] = useState('');
  const [surfaceFilter, setSurfaceFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const surfaceOptions = useMemo(
    () =>
      [...new Set(skills.map((skill) => skill.od.surface))]
        .sort()
        .map((surface) => ({
          label: localizedSurfaceLabel(surface, t.design.surfaces),
          value: surface,
        })),
    [skills, t.design.surfaces],
  );
  const categoryOptions = useMemo(
    () =>
      [
        ...new Set(
          skills
            .map(skillCategory)
            .filter((category): category is string => Boolean(category)),
        ),
      ]
        .sort()
        .map((category) => ({ label: category, value: category })),
    [skills],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((skill) => {
      const category = skillCategory(skill);
      if (surfaceFilter !== 'all' && skill.od.surface !== surfaceFilter) {
        return false;
      }
      if (categoryFilter !== 'all' && category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return [
        skill.name,
        skill.slug,
        skill.description,
        skill.source,
        skill.trigger,
        skill.category,
        skill.od.mode,
        skill.od.surface,
        skill.od.scenario,
        skill.od.examplePrompt,
        ...(skill.od.capabilitiesRequired ?? []),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q));
    });
  }, [skills, categoryFilter, query, surfaceFilter]);

  const createFromSkill = async (skill: DesignSkillRecord) => {
    setCreatingId(skill.id);
    setError('');
    try {
      await onCreate(skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreatingId(null);
    }
  };

  const updateInstall = async (skill: DesignSkillRecord) => {
    setInstallingId(skill.id);
    setError('');
    try {
      if (skill.canUninstall) {
        await uninstallDesignSkillCatalogPack(skill.id);
      } else {
        await installDesignSkillCatalogPack(skill.id);
      }
      onCatalogChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <GalleryFilters
          query={query}
          onQueryChange={setQuery}
          queryPlaceholder={t.design.searchSkills}
          searchTestId="skills-search"
          filters={[
            {
              label: t.design.surfaceFilter,
              value: surfaceFilter,
              onChange: setSurfaceFilter,
              allLabel: t.design.allSurfaces,
              options: surfaceOptions,
              testId: 'skills-surface-filter',
            },
            {
              label: t.design.categoryFilter,
              value: categoryFilter,
              onChange: setCategoryFilter,
              allLabel: t.design.allCategories,
              options: categoryOptions,
              testId: 'skills-category-filter',
            },
          ]}
        />
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.design.noMatches}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((skill) => (
              <article
                key={skill.id}
                role="button"
                tabIndex={0}
                className="border-border bg-card hover:border-primary/40 focus-visible:ring-ring/50 cursor-pointer rounded-md border p-4 transition-colors outline-none focus-visible:ring-2"
                onClick={() => {
                  setError('');
                  setPreviewSkill(skill);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setError('');
                    setPreviewSkill(skill);
                  }
                }}
                data-testid={`skill-card-${skill.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{skill.name}</h3>
                    <p className="text-muted-foreground mt-1 line-clamp-3 text-xs">
                      {skill.description}
                    </p>
                  </div>
                  <span className="bg-muted shrink-0 rounded px-2 py-1 text-xs">
                    {surfaceLabel(skill.od.surface)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1 text-xs">
                  <span className="bg-muted rounded px-2 py-1">
                    {skill.origin === 'installed'
                      ? t.design.catalogInstalled
                      : t.design.catalogBuiltIn}
                  </span>
                  {skill.version && (
                    <span className="bg-muted rounded px-2 py-1">
                      {skill.version}
                    </span>
                  )}
                </div>
                {skill.od.examplePrompt && (
                  <p className="text-muted-foreground mt-3 line-clamp-2 text-xs">
                    {skill.od.examplePrompt}
                  </p>
                )}
                {isSelectedSkill(selectedId, skill) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-4"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {t.design.defaultSkill}
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
      <SkillSourceModal
        skill={previewSkill}
        selected={Boolean(
          previewSkill && isSelectedSkill(selectedId, previewSkill),
        )}
        creating={Boolean(previewSkill && creatingId === previewSkill.id)}
        installPending={Boolean(
          previewSkill && installingId === previewSkill.id,
        )}
        error={error}
        onCreate={(skill) => void createFromSkill(skill)}
        onInstallChange={(skill) => void updateInstall(skill)}
        onSelectDefault={onSelectDefault}
        onOpenChange={(open) => {
          if (!open) setPreviewSkill(null);
        }}
      />
    </>
  );
}

function skillCategory(skill: DesignSkillRecord) {
  return skill.category || skill.od.scenario || skill.od.mode || '';
}

function isSelectedSkill(
  selectedId: string | undefined,
  skill: DesignSkillRecord,
): boolean {
  return selectedId === skill.id || selectedId === skill.slug;
}
