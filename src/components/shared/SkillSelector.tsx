/**
 * Skill Selector
 *
 * Toolbar button + popover for pinning skills to the current message.
 * Appears in the ChatInput bottom toolbar beside the MCP selector.
 *
 * Users can pin up to 3 skills. Pinned skills are preloaded into the
 * agent's context at the start of the conversation, guaranteeing the
 * agent has those capabilities without needing to discover them.
 *
 * Only visible when the current agent type supports skills (e.g. claude).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Check, Search, Sparkles } from 'lucide-react';

import type { SkillInfo } from '@/shared/hooks/useSkills';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

/** Maximum number of skills that can be pinned per message */
export const MAX_PINNED_SKILLS = 3;

// ────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────

export interface SkillSelectorProps {
  /** All available skills from the backend. */
  skills: SkillInfo[];
  /** Currently selected (pinned) skill slugs for this message. */
  selected: string[];
  /** Called when a skill is toggled on or off. */
  onToggle: (skillSlug: string) => void;
  /** Whether the input is disabled (agent running, etc.). */
  disabled?: boolean;
  /** Compact mode for the reply variant. */
  compact?: boolean;
}

// ────────────────────────────────────────────────────────────────────
// Skill row — extracted to avoid duplication between pinned and list
// ────────────────────────────────────────────────────────────────────

function SkillRow({
  skill,
  isSelected,
  isDisabled,
  onToggle,
}: {
  skill: SkillInfo;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: (slug: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(skill.slug)}
      disabled={isDisabled}
      className={cn(
        'flex w-full items-start gap-3 px-3 py-2 text-left transition-colors',
        isDisabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-accent',
      )}
    >
      <div className="bg-muted text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-[10px]">
        <Sparkles className="size-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground truncate text-sm">{skill.name}</span>
          {skill.trigger && (
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1 py-0.5 font-mono text-[10px]">
              {skill.trigger}
            </span>
          )}
        </div>
        {skill.description && (
          <span className="text-muted-foreground block truncate text-xs">
            {skill.description}
          </span>
        )}
      </div>
      {isSelected && (
        <Check className="text-foreground mt-0.5 size-4 shrink-0" />
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

export function SkillSelector({
  skills,
  selected,
  onToggle,
  disabled = false,
  compact = false,
}: SkillSelectorProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on click outside or Escape key
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleToggle = useCallback(
    (slug: string) => {
      // Prevent selecting more than MAX_PINNED_SKILLS
      if (!selected.includes(slug) && selected.length >= MAX_PINNED_SKILLS) {
        return;
      }
      onToggle(slug);
    },
    [onToggle, selected],
  );

  const filtered = useMemo(
    () =>
      filter
        ? skills.filter(
            (s) =>
              s.name.toLowerCase().includes(filter.toLowerCase()) ||
              s.description?.toLowerCase().includes(filter.toLowerCase()) ||
              s.trigger?.toLowerCase().includes(filter.toLowerCase()),
          )
        : skills,
    [skills, filter],
  );

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const skill of filtered) {
      const cat = skill.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(skill);
    }
    return groups;
  }, [filtered]);

  if (skills.length === 0) return null;

  const atLimit = selected.length >= MAX_PINNED_SKILLS;

  return (
    <div className="relative">
      {/* Toolbar Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            setOpen(true);
            setFilter('');
          }
        }}
        disabled={disabled}
        className={cn(
          'relative flex items-center justify-center transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          compact
            ? 'text-muted-foreground hover:bg-accent hover:text-foreground size-7 rounded-md'
            : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground size-8 rounded-full border',
          selected.length > 0 && 'text-foreground',
        )}
        aria-label={t.home.skills}
      >
        <Sparkles className="size-4" />
        {/* Badge */}
        {selected.length > 0 && (
          <span className="bg-foreground text-background absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] leading-none font-medium">
            {selected.length}
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          className={cn(
            'border-border bg-popover absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border shadow-lg',
            'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2',
          )}
        >
          {/* Header */}
          <div className="border-border flex items-center justify-between border-b px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="text-muted-foreground size-3.5" />
              <span className="text-foreground text-sm font-medium">
                {t.home.skills}
              </span>
            </div>
            <span className="text-muted-foreground text-xs">
              {selected.length}/{MAX_PINNED_SKILLS}
            </span>
          </div>

          {/* Search (only show when 5+ skills) */}
          {skills.length >= 5 && (
            <div className="border-border border-b px-3 py-2">
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t.home.skillsSearch}
                  className="bg-muted/50 text-foreground placeholder:text-muted-foreground h-7 w-full rounded-md pr-2 pl-7 text-xs focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Skill List */}
          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="text-muted-foreground px-3 py-4 text-center text-xs">
                {t.home.skillsNoSkillsFound}
              </div>
            ) : (
              <>
                {/* Pinned / selected skills at top */}
                {selected.length > 0 && (
                  <>
                    {filtered
                      .filter((s) => selected.includes(s.slug))
                      .map((skill) => (
                        <SkillRow
                          key={`pinned-${skill.slug}`}
                          skill={skill}
                          isSelected
                          isDisabled={false}
                          onToggle={handleToggle}
                        />
                      ))}
                    <div className="border-border mx-3 my-1 border-t" />
                  </>
                )}

                {/* Remaining skills grouped by category */}
                {Object.entries(grouped).map(([category, categorySkills]) => {
                  const unselected = categorySkills.filter(
                    (s) => !selected.includes(s.slug),
                  );
                  if (unselected.length === 0) return null;
                  return (
                    <div key={category}>
                      {Object.keys(grouped).length > 1 && (
                        <div className="text-muted-foreground px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase">
                          {category}
                        </div>
                      )}
                      {unselected.map((skill) => {
                        const isDisabled = atLimit;
                        return (
                          <SkillRow
                            key={`${skill.source}-${skill.slug}`}
                            skill={skill}
                            isSelected={false}
                            isDisabled={isDisabled}
                            onToggle={handleToggle}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Footer hint */}
          {atLimit && (
            <div className="border-border border-t px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {t.home.skillsMaxReached}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
