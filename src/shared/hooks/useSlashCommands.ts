import { useCallback, useMemo } from 'react';

import { useNavigate } from 'react-router-dom';

import { API_BASE_URL } from '@/config';
import type { SkillInfo } from '@/shared/hooks/useSkills';
import { useLanguage } from '@/shared/providers/language-provider';

export interface SlashCommand {
  name: string;
  category:
    | 'session'
    | 'model'
    | 'workspace'
    | 'skill'
    | 'automation'
    | 'export'
    | 'help';
  description: string;
  shortcut?: string;
  args?: string;
  execute: (args?: string) => void | Promise<void>;
}

export interface SlashCommandActions {
  /** Clear current conversation messages */
  onClear?: () => void;
  /** Open model selector dropdown */
  onModelSelect?: () => void;
  /** Open workspace/folder picker */
  onWorkspacePick?: () => void;
  /** Insert text into the composer */
  onInsertText?: (text: string) => void;
  /** Current task ID for export */
  taskId?: string;
  /** Available skills (those with triggers become slash commands) */
  skills?: SkillInfo[];
  /** Callback when a skill trigger is invoked */
  onSkillTrigger?: (skillSlug: string) => void;
}

export function useSlashCommands(actions?: SlashCommandActions): {
  commands: SlashCommand[];
  getCategoryLabel: (category: string) => string;
} {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const getCategoryLabel = useCallback(
    (category: string): string => {
      const labels: Record<string, string> = {
        session: t.slashCommands.categorySession,
        model: t.slashCommands.categoryModel,
        workspace: t.slashCommands.categoryWorkspace,
        skill: t.slashCommands.categorySkill,
        automation: t.slashCommands.categoryAutomation,
        export: t.slashCommands.categoryExport,
        help: t.slashCommands.categoryHelp,
      };
      return labels[category] || category;
    },
    [t],
  );

  const commands = useMemo<SlashCommand[]>(
    () => [
      {
        name: 'new',
        category: 'session',
        description: t.slashCommands.newSession,
        execute: () => navigate('/'),
      },
      {
        name: 'clear',
        category: 'session',
        description: t.slashCommands.clearHistory,
        execute: () => {
          if (actions?.onClear) {
            actions.onClear();
          } else {
            // Fallback: reload the current page to reset state
            window.location.reload();
          }
        },
      },
      {
        name: 'compact',
        category: 'session',
        description: t.slashCommands.compactContext,
        execute: () => {
          // Future: context compression. For now, navigate to new session.
          navigate('/');
        },
      },
      {
        name: 'model',
        category: 'model',
        description: t.slashCommands.switchModel,
        execute: () => {
          if (actions?.onModelSelect) {
            actions.onModelSelect();
          }
        },
      },
      {
        name: 'workspace',
        category: 'workspace',
        description: t.slashCommands.setWorkspace,
        execute: () => {
          if (actions?.onWorkspacePick) {
            actions.onWorkspacePick();
          }
        },
      },
      {
        name: 'search',
        category: 'automation',
        description: t.slashCommands.searchWeb,
        args: '<query>',
        execute: () => {
          actions?.onInsertText?.('/search ');
        },
      },
      {
        name: 'export',
        category: 'export',
        description: t.slashCommands.exportChat,
        execute: async () => {
          // Try props, then extract from URL (e.g. /task/abc-123)
          const taskId =
            actions?.taskId ||
            window.location.pathname.match(/\/task\/([^/]+)/)?.[1];
          if (!taskId) return;
          try {
            const res = await fetch(
              `${API_BASE_URL}/db/tasks/${taskId}/messages`,
            );
            if (!res.ok) return;
            const messages = await res.json();
            // Build markdown from messages
            const lines: string[] = ['# Conversation Export\n'];
            for (const msg of messages) {
              if (msg.type === 'user') {
                lines.push(`## User\n${msg.content || ''}\n`);
              } else if (msg.type === 'text' && msg.content) {
                lines.push(`## Assistant\n${msg.content}\n`);
              }
            }
            const md = lines.join('\n');
            // Download as file
            const blob = new Blob([md], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `conversation-${taskId.slice(0, 8)}.md`;
            a.click();
            URL.revokeObjectURL(url);
          } catch {
            // ignore export errors
          }
        },
      },
      {
        name: 'help',
        category: 'help',
        description: t.slashCommands.showHelp,
        execute: () => {
          // No-op: the menu itself is the help — just keep it open
          // The menu will close on its own after selection
        },
      },
      {
        name: 'dashboard',
        category: 'session',
        description: t.nav.dashboard,
        execute: () => navigate('/dashboard'),
      },
      {
        name: 'projects',
        category: 'session',
        description: t.nav.projects,
        execute: () => navigate('/projects'),
      },
      {
        name: 'library',
        category: 'session',
        description: t.nav.allTasks,
        execute: () => navigate('/library'),
      },
      {
        name: 'automation',
        category: 'automation',
        description: t.nav.automation,
        execute: () => navigate('/automation'),
      },
      {
        name: 'skills',
        category: 'skill',
        description: t.nav.settings + ' — ' + t.slashCommands.categorySkill,
        execute: () => {
          window.dispatchEvent(
            new CustomEvent('open-settings', { detail: 'skills' }),
          );
        },
      },
      {
        name: 'mcp',
        category: 'skill',
        description: t.nav.settings + ' — MCP',
        execute: () => {
          window.dispatchEvent(
            new CustomEvent('open-settings', { detail: 'mcp' }),
          );
        },
      },
    ],
    [navigate, t, actions],
  );

  // Merge skill triggers into commands
  const allCommands = useMemo(() => {
    if (!actions?.skills) return commands;

    const skillCommands: SlashCommand[] = actions.skills
      .filter((s) => s.trigger)
      .map((s) => ({
        name: s.trigger!.replace(/^\//, ''),
        category: 'skill' as const,
        description: s.description || s.name,
        execute: () => {
          if (actions.onSkillTrigger) {
            actions.onSkillTrigger(s.slug);
          }
        },
      }));

    return [...commands, ...skillCommands];
  }, [commands, actions]);

  return { commands: allCommands, getCategoryLabel };
}
