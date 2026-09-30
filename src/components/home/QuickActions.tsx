/**
 * QuickActions — "More ideas" overflow for the Home suggestion row.
 *
 * Category prompts used to render as a second chip row. They now live in
 * this menu so Home shows one row. The Ideas gallery replaces this later.
 */

import { useState } from 'react';

import { BarChart3, Code2, ListChecks, PenLine, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/shared/providers/language-provider';

type CategoryKey = 'write' | 'code' | 'analyze' | 'create' | 'plan';

interface CategoryDef {
  key: CategoryKey;
  icon: LucideIcon;
}

interface QuickActionItem {
  label: string;
  prompt: string;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'write', icon: PenLine },
  { key: 'code', icon: Code2 },
  { key: 'analyze', icon: BarChart3 },
  { key: 'create', icon: Sparkles },
  { key: 'plan', icon: ListChecks },
];

const CATEGORY_ITEMS: Record<CategoryKey, readonly string[]> = {
  write: ['draftEmail', 'writeDocs', 'editText', 'writeBlog', 'narrateText'],
  code: [
    'buildFeature',
    'debugIssue',
    'refactorCode',
    'writeTests',
    'automateWeb',
  ],
  analyze: [
    'analyzeData',
    'researchTopic',
    'compareOptions',
    'summarize',
    'transcribeAudio',
  ],
  create: [
    'designUI',
    'createPresentation',
    'brainstorm',
    'generateImage',
    'createVideo',
  ],
  plan: [
    'planProject',
    'createRoadmap',
    'organizeWorkflow',
    'writeSpec',
    'manageIssues',
  ],
};

function readQuickActionItem(
  items: { [key: string]: QuickActionItem },
  itemKey: string,
): QuickActionItem {
  const item = items[itemKey];
  if (!item) {
    throw new Error(`Missing quick action item: ${itemKey}`);
  }
  return item;
}

interface QuickActionsProps {
  onSelectPrompt: (prompt: string) => void;
}

export function QuickActions({ onSelectPrompt }: QuickActionsProps) {
  const { t } = useLanguage();
  const categories = t.home.quickActionCategories;
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(
    null,
  );

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setActiveCategory(null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="border-border/60 bg-background text-muted-foreground hover:border-primary/30 hover:bg-accent hover:text-foreground flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm transition-colors"
        >
          {t.home.quickActions.moreIdeas}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-52">
        {activeCategory === null
          ? CATEGORIES.map(({ key, icon: Icon }) => (
              <DropdownMenuItem
                key={key}
                onSelect={(event) => {
                  event.preventDefault();
                  setActiveCategory(key);
                }}
              >
                <Icon />
                {categories[key].label}
              </DropdownMenuItem>
            ))
          : [
              <DropdownMenuItem
                key="back"
                onSelect={(event) => {
                  event.preventDefault();
                  setActiveCategory(null);
                }}
              >
                {t.home.quickActions.back}
              </DropdownMenuItem>,
              ...CATEGORY_ITEMS[activeCategory].map((itemKey) => {
                const item = readQuickActionItem(
                  categories[activeCategory].items,
                  itemKey,
                );
                return (
                  <DropdownMenuItem
                    key={itemKey}
                    onSelect={() => onSelectPrompt(item.prompt)}
                  >
                    {item.label}
                  </DropdownMenuItem>
                );
              }),
            ]}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
