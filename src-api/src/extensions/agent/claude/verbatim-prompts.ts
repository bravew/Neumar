/**
 * `verbatimPrompts` is a trust boundary for channel and scheduled prompts.
 * Claude Code before 2.1.248 silently ignores the field, which re-opens
 * `@path` expansion and slash-command dispatch on untrusted text.
 *
 * The option also skips the CLI's turn-start attachment pass on the first
 * turn (nested CLAUDE.md, rules, skill/tool listings, `@server:resource`)
 * until after the first tool call. That is an accepted tradeoff for
 * untrusted input.
 */

export const VERBATIM_PROMPTS_MIN_VERSION = '2.1.248';

export function supportsVerbatimPrompts(version: string | undefined): boolean {
  if (!version) return false;
  return compareSemver(version, VERBATIM_PROMPTS_MIN_VERSION) >= 0;
}

function compareSemver(left: string, right: string): number {
  const a = left.split('.').map((part) => parseInt(part, 10));
  const b = right.split('.').map((part) => parseInt(part, 10));
  if (
    a.length < 3 ||
    b.length < 3 ||
    a.some((part) => Number.isNaN(part)) ||
    b.some((part) => Number.isNaN(part))
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

export interface ClaudeExecutableChoice {
  path: string;
  version: string | undefined;
  usedSidecarFallback: boolean;
}

/**
 * Pick a CLI that will actually honor `verbatimPrompts`. An older binary on
 * PATH is replaced by a new enough bundled sidecar when one exists. Otherwise
 * the run is refused: unknown and too-old versions fail closed.
 */
export function selectClaudePathForVerbatim(input: {
  preferredPath: string;
  preferredVersion: string | undefined;
  sidecarPath?: string;
  sidecarVersion?: string;
  verbatimRequired: boolean;
}):
  | { ok: true; choice: ClaudeExecutableChoice }
  | { ok: false; message: string } {
  if (
    !input.verbatimRequired ||
    supportsVerbatimPrompts(input.preferredVersion)
  ) {
    return {
      ok: true,
      choice: {
        path: input.preferredPath,
        version: input.preferredVersion,
        usedSidecarFallback: false,
      },
    };
  }

  if (
    input.sidecarPath &&
    input.sidecarPath !== input.preferredPath &&
    supportsVerbatimPrompts(input.sidecarVersion)
  ) {
    return {
      ok: true,
      choice: {
        path: input.sidecarPath,
        version: input.sidecarVersion,
        usedSidecarFallback: true,
      },
    };
  }

  const seen = input.preferredVersion ?? 'unknown';
  return {
    ok: false,
    message:
      `Claude Code CLI ${seen} does not support verbatim prompts ` +
      `(requires ${VERBATIM_PROMPTS_MIN_VERSION} or later). ` +
      'This run was refused so untrusted text cannot expand @paths or dispatch slash commands. ' +
      'Update the Claude CLI on PATH, or rebuild with a bundled CLI that meets that version.',
  };
}
