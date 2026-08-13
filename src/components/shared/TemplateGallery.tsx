/**
 * TemplateGallery
 *
 * Modal-ready gallery component that displays bundled assistant templates
 * in a filterable grid. Users can search, filter by category, and select
 * a template to start a conversation with a pre-configured assistant.
 */

import { useCallback, useMemo, useState } from 'react';

import {
  BarChart3,
  CalendarDays,
  FileText,
  GitPullRequest,
  Palette,
  Search,
  Share2,
  Shield,
  TestTube,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { AssistantTemplate } from '@/config/assistant-templates';
import { BUNDLED_TEMPLATES } from '@/config/assistant-templates';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ────────────────────────────────────────────────────────────────────
// Icon map — avoids dynamic imports for the small set of bundled icons
// ────────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  GitPullRequest,
  FileText,
  Search,
  BarChart3,
  Palette,
  CalendarDays,
  Share2,
  TestTube,
  Shield,
};

// ────────────────────────────────────────────────────────────────────
// Category filter config
// ────────────────────────────────────────────────────────────────────

type CategoryFilter = 'all' | AssistantTemplate['category'];

const CATEGORY_FILTERS: CategoryFilter[] = [
  'all',
  'dev',
  'writing',
  'research',
  'data',
  'design',
  'ops',
];

// ────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────

export interface TemplateGalleryProps {
  onSelect: (template: AssistantTemplate) => void;
  onClose?: () => void;
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

export function TemplateGallery({ onSelect, onClose }: TemplateGalleryProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');

  const categoryLabel = useCallback(
    (cat: CategoryFilter): string => {
      const labels: Record<CategoryFilter, string> = {
        all: t.templates.allCategories,
        dev: t.templates.dev,
        writing: t.templates.writing,
        research: t.templates.research,
        data: t.templates.data,
        design: t.templates.design,
        ops: t.templates.ops,
      };
      return labels[cat];
    },
    [t],
  );

  const filtered = useMemo(() => {
    let results = BUNDLED_TEMPLATES;

    if (activeCategory !== 'all') {
      results = results.filter((tpl) => tpl.category === activeCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      results = results.filter(
        (tpl) =>
          tpl.name.toLowerCase().includes(q) ||
          tpl.description.toLowerCase().includes(q),
      );
    }

    return results;
  }, [activeCategory, search]);

  const handleSelect = useCallback(
    (template: AssistantTemplate) => {
      onSelect(template);
      onClose?.();
    },
    [onSelect, onClose],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Search input */}
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.templates.search}
          className="bg-muted/50 text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-full rounded-lg pr-3 pl-9 text-sm focus:ring-1 focus:outline-none"
          autoFocus
        />
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activeCategory === cat
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {categoryLabel(cat)}
          </button>
        ))}
      </div>

      {/* Template grid */}
      {filtered.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {t.templates.noTemplates}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              categoryLabel={categoryLabel(template.category)}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// TemplateCard (sub-component)
// ────────────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: AssistantTemplate;
  categoryLabel: string;
  onSelect: (template: AssistantTemplate) => void;
}

function TemplateCard({
  template,
  categoryLabel,
  onSelect,
}: TemplateCardProps) {
  const Icon = ICON_MAP[template.icon] ?? Search;

  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className={cn(
        'border-border hover:border-foreground/20 hover:bg-accent/50 group flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all',
        'focus:ring-ring focus:ring-1 focus:outline-none',
      )}
    >
      {/* Icon + Category badge row */}
      <div className="flex w-full items-center justify-between">
        <div className="bg-muted text-muted-foreground group-hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors">
          <Icon className="size-4" />
        </div>
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
          {categoryLabel}
        </span>
      </div>

      {/* Name */}
      <span className="text-foreground text-sm font-medium">
        {template.name}
      </span>

      {/* Description */}
      <span className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
        {template.description}
      </span>
    </button>
  );
}
