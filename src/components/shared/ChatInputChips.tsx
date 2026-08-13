/**
 * MCP server and Skill chip strips for ChatInput.
 * Shows selected MCP servers and pinned skills as removable badges.
 */

import { Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { DURATION, EASE } from '@/config/animation';
import type { McpServerInfo } from '@/shared/hooks/useMcpServers';
import type { SkillInfo } from '@/shared/hooks/useSkills';

import { McpIcon } from './McpSelector';

export function McpChips({
  selected,
  servers,
  onRemove,
}: {
  selected: string[];
  servers: McpServerInfo[];
  onRemove: (name: string) => void;
}) {
  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          className="mb-2 flex flex-wrap gap-1.5"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: DURATION.normal, ease: EASE.out }}
        >
          {selected.map((name) => {
            const server = servers.find((s) => s.name === name);
            return (
              <motion.span
                key={name}
                className="bg-muted/60 border-border/50 text-foreground group inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                {server?.icon ? (
                  <img
                    src={server.icon}
                    alt=""
                    className="size-3 rounded object-contain"
                  />
                ) : (
                  <McpIcon className="size-3 opacity-50" />
                )}
                <span>@{name}</span>
                <button
                  type="button"
                  onClick={() => onRemove(name)}
                  className="text-muted-foreground hover:text-foreground -mr-0.5 ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`Remove ${name}`}
                >
                  <X className="size-3" />
                </button>
              </motion.span>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SkillChips({
  selected,
  skills,
  onRemove,
}: {
  selected: string[];
  skills: SkillInfo[];
  onRemove: (slug: string) => void;
}) {
  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          className="mb-2 flex flex-wrap gap-1.5"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: DURATION.normal, ease: EASE.out }}
        >
          {selected.map((slug) => {
            const skill = skills.find((s) => s.slug === slug);
            return (
              <motion.span
                key={slug}
                className="bg-muted/60 border-border/50 text-foreground group inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <Sparkles className="size-3 opacity-50" />
                <span>{skill?.name ?? slug}</span>
                <button
                  type="button"
                  onClick={() => onRemove(slug)}
                  className="text-muted-foreground hover:text-foreground -mr-0.5 ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`Remove ${skill?.name ?? slug}`}
                >
                  <X className="size-3" />
                </button>
              </motion.span>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
