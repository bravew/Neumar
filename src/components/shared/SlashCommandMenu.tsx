import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Folder,
  HelpCircle,
  MessageSquare,
  MonitorCog,
  Share,
  Sparkles,
  Workflow,
  Zap,
} from 'lucide-react';

import type {
  SlashCommand,
  SlashCommandActions,
} from '@/shared/hooks/useSlashCommands';
import { useSlashCommands } from '@/shared/hooks/useSlashCommands';
import { cn } from '@/shared/lib/utils';

interface SlashCommandMenuProps {
  open: boolean;
  /** The text after `/` for filtering */
  search: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  /** Actions passed through to useSlashCommands for real command execution */
  actions?: SlashCommandActions;
}

const CATEGORY_ICONS: Record<string, typeof Zap> = {
  session: MessageSquare,
  model: MonitorCog,
  workspace: Folder,
  skill: Sparkles,
  automation: Workflow,
  export: Share,
  help: HelpCircle,
};

export function SlashCommandMenu({
  open,
  search,
  onSelect,
  onClose,
  actions,
}: SlashCommandMenuProps) {
  const { commands, getCategoryLabel } = useSlashCommands(actions);
  const ref = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter commands based on search text
  const filtered = useMemo(() => {
    if (!search) return commands;
    const lower = search.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lower) ||
        cmd.description.toLowerCase().includes(lower),
    );
  }, [commands, search]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // Keyboard navigation — listen on document since textarea has focus
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const cmd = filtered[selectedIndex];
        if (cmd) onSelect(cmd);
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        const cmd = filtered[selectedIndex];
        if (cmd) onSelect(cmd);
      }
    },
    [open, filtered, selectedIndex, onSelect, onClose],
  );

  useEffect(() => {
    if (!open) return;
    // Use capture phase to intercept before textarea's handleKeyDown
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, handleKeyDown]);

  // Scroll selected item into view
  useEffect(() => {
    if (!open) return;
    const el = ref.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedIndex]);

  if (!open || filtered.length === 0) return null;

  // Group filtered commands by category
  const grouped: { category: string; cmds: SlashCommand[] }[] = [];
  const categoryMap = new Map<string, SlashCommand[]>();
  for (const cmd of filtered) {
    let list = categoryMap.get(cmd.category);
    if (!list) {
      list = [];
      categoryMap.set(cmd.category, list);
      grouped.push({ category: cmd.category, cmds: list });
    }
    list.push(cmd);
  }

  let flatIndex = 0;

  return (
    <div
      ref={ref}
      data-testid="slash-command-menu"
      className="bg-popover border-border absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border shadow-lg"
    >
      <div className="scrollbar-hide max-h-64 overflow-y-auto p-1">
        {grouped.map(({ category, cmds }) => (
          <div key={category}>
            <div className="text-muted-foreground px-3 py-1.5 text-xs font-medium">
              {getCategoryLabel(category)}
            </div>
            {cmds.map((cmd) => {
              const Icon = CATEGORY_ICONS[cmd.category] || Zap;
              const idx = flatIndex++;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={cmd.name}
                  data-selected={isSelected}
                  onClick={() => onSelect(cmd)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    isSelected
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                  )}
                >
                  <Icon className="text-muted-foreground size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-foreground font-medium">
                      /{cmd.name}
                    </span>
                    {cmd.args && (
                      <span className="text-muted-foreground ml-1 text-xs">
                        {cmd.args}
                      </span>
                    )}
                    <p className="text-muted-foreground truncate text-xs">
                      {cmd.description}
                    </p>
                  </div>
                  {cmd.shortcut && (
                    <kbd className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">
                      {cmd.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
