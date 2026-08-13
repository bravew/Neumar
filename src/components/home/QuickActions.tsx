/**
 * QuickActions — category pill buttons with expandable sub-item panel.
 *
 * Shown below the ChatInput on the Home page. Clicking a category pill
 * expands a panel of prompt templates; clicking a sub-item prefills the
 * ChatInput and closes the panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BarChart3,
  ChevronRight,
  Code2,
  ListChecks,
  PenLine,
  Sparkles,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import {
  DURATION,
  EASE,
  fadeScale,
  listItem,
  STAGGER,
  staggerContainerFast,
} from '@/config/animation';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CategoryKey = 'write' | 'code' | 'analyze' | 'create' | 'plan';

interface CategoryDef {
  key: CategoryKey;
  icon: LucideIcon;
}

// ---------------------------------------------------------------------------
// Constants (module-level to avoid re-creation)
// ---------------------------------------------------------------------------

const CATEGORIES: CategoryDef[] = [
  { key: 'write', icon: PenLine },
  { key: 'code', icon: Code2 },
  { key: 'analyze', icon: BarChart3 },
  { key: 'create', icon: Sparkles },
  { key: 'plan', icon: ListChecks },
];

// Map each category to its ordered item keys
const CATEGORY_ITEMS: Record<CategoryKey, string[]> = {
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface QuickActionsProps {
  onSelectPrompt: (prompt: string) => void;
}

export function QuickActions({ onSelectPrompt }: QuickActionsProps) {
  const { t } = useLanguage();
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!activeCategory) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveCategory(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeCategory]);

  // Close on click outside
  useEffect(() => {
    if (!activeCategory) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setActiveCategory(null);
      }
    };
    // Delay listener so the pill click doesn't immediately close
    const id = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClick);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [activeCategory]);

  const handlePillClick = useCallback((key: CategoryKey) => {
    setActiveCategory((prev) => (prev === key ? null : key));
  }, []);

  const handleItemClick = useCallback(
    (prompt: string) => {
      onSelectPrompt(prompt);
      setActiveCategory(null);
    },
    [onSelectPrompt],
  );

  const categories = t.home.quickActionCategories;

  return (
    <div className="flex w-full flex-col items-center gap-3" ref={panelRef}>
      {/* Category pills */}
      <motion.div
        className="flex flex-wrap justify-center gap-2"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: {
            transition: { staggerChildren: STAGGER.fast },
          },
        }}
      >
        {CATEGORIES.map(({ key, icon: Icon }) => {
          const isActive = activeCategory === key;
          return (
            <motion.button
              key={key}
              type="button"
              onClick={() => handlePillClick(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/20 hover:bg-muted/50 hover:text-foreground',
              )}
              variants={{
                hidden: { opacity: 0, y: 8 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: DURATION.normal, ease: EASE.out },
                },
              }}
              whileTap={{ scale: 0.97 }}
            >
              <Icon className="h-3.5 w-3.5" />
              {categories[key].label}
            </motion.button>
          );
        })}
      </motion.div>

      {/* Expandable panel */}
      <AnimatePresence mode="wait">
        {activeCategory && (
          <motion.div
            key={activeCategory}
            className="border-border bg-card w-full overflow-hidden rounded-xl border shadow-sm"
            variants={fadeScale}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Panel header */}
            <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
              <div className="flex items-center gap-2">
                {(() => {
                  const category = CATEGORIES.find(
                    (c) => c.key === activeCategory,
                  );
                  if (!category) return null;
                  return <category.icon className="text-primary h-4 w-4" />;
                })()}
                <span className="text-sm font-medium">
                  {categories[activeCategory].label}
                </span>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setActiveCategory(null)}
                className="text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Sub-items */}
            <motion.div
              className="flex flex-col"
              variants={staggerContainerFast}
              initial="hidden"
              animate="visible"
            >
              {CATEGORY_ITEMS[activeCategory].map((itemKey) => {
                const items = categories[activeCategory].items as Record<
                  string,
                  { label: string; prompt: string }
                >;
                const item = items[itemKey];
                return (
                  <motion.button
                    key={itemKey}
                    type="button"
                    onClick={() => handleItemClick(item.prompt)}
                    className="hover:bg-muted/50 group flex items-center justify-between px-4 py-2.5 text-left transition-colors"
                    variants={listItem}
                  >
                    <span className="text-foreground text-sm">
                      {item.label}
                    </span>
                    <ChevronRight className="text-muted-foreground h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </motion.button>
                );
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
