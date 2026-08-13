/**
 * Skill-anchor parsing.
 *
 * Some Claude Code plugins inject a SessionStart "discipline anchor" that
 * instructs the model to begin every reply with a literal `Skill: <slug>`
 * line. Rendered verbatim that line is noise, and it hijacks auto-generated
 * session titles.
 *
 * We detect that specific leading line and lift it out of the body so the UI
 * can show it as a subtle indicator instead of plain text, and so titles are
 * derived from the real content.
 */

// A leading line that is exactly `Skill: <kebab-slug>`, optionally followed by
// a parenthetical note. Anchored to the start and requiring the line to
// contain nothing else keeps legitimate messages that merely mention
// "Skill:" from matching.
const SKILL_ANCHOR_RE =
  /^[ \t]*Skill:[ \t]*([a-z][a-z0-9]*(?:-[a-z0-9]+)*)[ \t]*(?:\([^)]*\))?[ \t]*(?:\r?\n|$)/;

export interface ParsedSkillAnchor {
  /** The skill slug from the leading anchor line, or null when absent. */
  skill: string | null;
  /** The message body with the anchor line (and its trailing blank) removed. */
  body: string;
}

/**
 * Split a leading `Skill: <slug>` anchor line off the front of a message.
 * Returns `{ skill: null, body: text }` unchanged when there is no anchor.
 */
export function parseSkillAnchor(text: string): ParsedSkillAnchor {
  if (!text) return { skill: null, body: text };
  const match = SKILL_ANCHOR_RE.exec(text);
  if (!match) return { skill: null, body: text };
  const body = text.slice(match[0].length).replace(/^\s*\n/, '');
  return { skill: match[1]!, body };
}

/** Convenience: the body with any leading skill anchor stripped. */
export function stripSkillAnchor(text: string): string {
  return parseSkillAnchor(text).body;
}
