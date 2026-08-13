/**
 * Command Parser
 *
 * Parses /commands from inbound messages.
 */

import type { ParsedCommand } from '../channels/types';

const FLAG_REGEX = /--(\w[\w-]*)(?:=(\S+))?/g;

export function parseCommand(text: string, prefix = '/'): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(prefix)) return null;

  // Build regex dynamically based on the configured prefix
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escapedPrefix}(\\S+)(?:\\s+(.*))?$`, 's').exec(
    trimmed,
  );
  if (!match) return null;

  const name = match[1]!.toLowerCase();
  const rest = match[2]?.trim() ?? '';

  // Extract flags
  const flags: Record<string, string> = {};
  let argsStr = rest;
  for (const flagMatch of rest.matchAll(FLAG_REGEX)) {
    flags[flagMatch[1]!] = flagMatch[2] ?? 'true';
    argsStr = argsStr.replace(flagMatch[0], '').trim();
  }

  // Split remaining text into args
  const args = argsStr ? argsStr.split(/\s+/).filter(Boolean) : [];

  return { name, args, flags, raw: trimmed };
}

/**
 * Build a full command name for permission checking.
 * e.g. /task create -> "task create", /help -> "help"
 */
export function getCommandPermissionKey(cmd: ParsedCommand): string {
  if (['task'].includes(cmd.name) && cmd.args.length > 0) {
    return `${cmd.name} ${cmd.args[0]}`;
  }
  return cmd.name;
}
