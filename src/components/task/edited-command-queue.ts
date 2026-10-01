/** An edited command cannot start a turn while the agent run is still active. */
export function enqueueEditedCommand(
  running: boolean,
  text: string,
): { queued: string | null; deliver: string | null } {
  if (running) return { queued: text, deliver: null };
  return { queued: null, deliver: text };
}

export function flushEditedCommand(
  running: boolean,
  queued: string | null,
): { queued: string | null; deliver: string | null } {
  if (running || !queued) return { queued, deliver: null };
  return { queued: null, deliver: queued };
}
