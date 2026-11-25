/**
 * Pure helpers for reading and updating LESSONS.md.
 *
 * Nothing here touches the network or the filesystem, so every rule the nightly
 * review applies to the file (cursor, distinct review days, idempotent evidence)
 * is covered by plain unit tests.
 *
 * File shape this module understands (see LESSONS.md):
 *
 *   <!-- reviewed-through: <sha> (<YYYY-MM-DD>) -->
 *   ## Section heading
 *   **Rule sentence, possibly wrapped over several lines.**
 *   - evidence bullet
 *   - Seen 2x (2026-10-13, 2026-11-23).
 */

const CURSOR_RE =
  /^<!-- reviewed-through: ([0-9a-f]{7,40}) \((\d{4}-\d{2}-\d{2})\) -->$/;
const SEEN_RE = /^- Seen (\d+)x \(([^)]*)\)\.\s*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Promotion into AGENTS.md needs this many distinct UTC review days. */
export const PROMOTION_REVIEW_DAYS = 3;

export function isUtcDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

/** Read the `reviewed-through` cursor from line 1. Returns null when absent. */
export function parseCursor(text) {
  const match = CURSOR_RE.exec(text.split('\n', 1)[0] ?? '');
  return match ? { sha: match[1], date: match[2] } : null;
}

/** Replace line 1 with a new cursor. Throws when the file has no cursor line. */
export function setCursor(text, sha, date) {
  if (!parseCursor(text)) {
    throw new Error('LESSONS.md has no `reviewed-through` cursor on line 1');
  }
  if (!/^[0-9a-f]{7,40}$/.test(sha))
    throw new Error(`invalid cursor sha: ${sha}`);
  if (!isUtcDate(date)) throw new Error(`invalid cursor date: ${date}`);
  const lines = text.split('\n');
  lines[0] = `<!-- reviewed-through: ${sha} (${date}) -->`;
  return lines.join('\n');
}

/** Lowercase, collapse whitespace, drop markdown emphasis. Used to match titles. */
export function normalizeTitle(title) {
  return title.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Split LESSONS.md into lessons. A lesson starts at a line that begins with `**`
 * and ends at the first blank line after its bullets, so wrapped rule sentences
 * stay in one title. Lessons without a `Seen` line (the parallel-agent rules,
 * which say they carry no count) are not returned.
 */
export function parseLessons(text) {
  const lines = text.split('\n');
  const lessons = [];
  let section = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      continue;
    }
    if (!line.startsWith('**')) continue;

    const titleLines = [];
    let cursor = i;
    while (cursor < lines.length) {
      titleLines.push(lines[cursor]);
      if (lines[cursor].trimEnd().endsWith('**')) break;
      cursor += 1;
    }
    const title = titleLines.join(' ');
    let end = cursor + 1;
    while (end < lines.length && lines[end].trim() !== '') end += 1;

    let seenLine = -1;
    for (let j = cursor + 1; j < end; j += 1) {
      if (SEEN_RE.test(lines[j])) seenLine = j;
    }
    if (seenLine !== -1) {
      const dates = SEEN_RE.exec(lines[seenLine])[2]
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      lessons.push({
        key: normalizeTitle(title),
        title: title.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(),
        section,
        titleStart: i,
        bodyStart: cursor + 1,
        end,
        seenLine,
        seenDates: dates,
      });
    }
    i = end;
  }
  return lessons;
}

export function formatSeen(dates) {
  const distinct = [...new Set(dates)].sort();
  return `- Seen ${distinct.length}x (${distinct.join(', ')}).`;
}

export function distinctReviewDays(dates) {
  return new Set(dates).size;
}

export function isPromotionCandidate(seenDates) {
  return distinctReviewDays(seenDates) >= PROMOTION_REVIEW_DAYS;
}

/**
 * True when every evidence reference is already cited in the lesson body. This
 * is what makes replaying a commit range a no-op: the references are the key.
 */
function containsRef(body, ref) {
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `#35` must not match inside `#351`, and a path ref must not match as the
  // tail of a longer path.
  return new RegExp(`(^|[^\\w/.-])${escaped}(?![\\w])`).test(body);
}

/**
 * The references go into the bullet text on purpose: `containsRef` reads them
 * back on the next run, which is what makes a replay a no-op.
 */
function evidenceBullet(e) {
  return `- ${e.reviewDate}: ${e.summary} (${e.refs.join(', ')}) Ran: ${e.ran} Missed: ${e.missed}`;
}

function allRefsPresent(body, refs) {
  return refs.every((ref) => containsRef(body, ref));
}

/**
 * Apply one piece of evidence to an existing lesson.
 *
 * - The review date joins the `Seen` set. A second incident on the same date
 *   changes nothing about the count.
 * - The evidence bullet is added only when at least one of its references is new
 *   to the lesson, so replaying the same range writes nothing.
 *
 * Returns the new text and whether anything changed.
 */
export function applyEvidence(text, lessonKey, evidence) {
  const lesson = parseLessons(text).find((l) => l.key === lessonKey);
  if (!lesson) throw new Error(`no lesson matches key: ${lessonKey}`);
  if (!isUtcDate(evidence.reviewDate)) {
    throw new Error(`invalid review date: ${evidence.reviewDate}`);
  }

  const lines = text.split('\n');
  const body = lines.slice(lesson.bodyStart, lesson.end).join('\n');
  const bullet = evidenceBullet(evidence);

  // Evidence with no new reference is a replay. It must not touch the Seen set
  // either, or replaying the same range on a later date would count one
  // incident on two review days.
  if (allRefsPresent(body, evidence.refs)) return { text, changed: false };

  const nextDates = [...new Set([...lesson.seenDates, evidence.reviewDate])];
  lines[lesson.seenLine] = formatSeen(nextDates);
  lines.splice(lesson.seenLine, 0, bullet);
  return { text: lines.join('\n'), changed: true };
}

/**
 * Insert a brand new lesson at the end of a named section. The lesson starts at
 * Seen 1x. Throws when the section is missing or the rule already exists.
 */
export function addLesson(text, proposal) {
  const title = proposal.rule.trim();
  const key = normalizeTitle(title);
  if (parseLessons(text).some((l) => l.key === key)) {
    return { text, changed: false };
  }
  const lines = text.split('\n');
  const sectionIndex = lines.findIndex(
    (l) => l.trim() === `## ${proposal.section}`,
  );
  if (sectionIndex === -1)
    throw new Error(`no section named: ${proposal.section}`);

  let next = sectionIndex + 1;
  while (next < lines.length && !lines[next].startsWith('## ')) next += 1;
  // Trim trailing blank lines so the new lesson sits directly under the last one.
  let insertAt = next;
  while (insertAt > sectionIndex + 1 && lines[insertAt - 1].trim() === '')
    insertAt -= 1;

  const block = [
    '',
    `**${title}**`,
    evidenceBullet(proposal),
    formatSeen([proposal.reviewDate]),
  ];
  lines.splice(insertAt, 0, ...block);
  return { text: lines.join('\n'), changed: true };
}

/** Lessons that reached the promotion threshold, for the report. */
export function promotionCandidates(text) {
  return parseLessons(text)
    .filter((l) => isPromotionCandidate(l.seenDates))
    .map((l) => ({
      key: l.key,
      title: l.title,
      days: distinctReviewDays(l.seenDates),
    }));
}

/**
 * Structural check used by a vitest case against the real LESSONS.md and by the
 * propose job before it pushes. Returns a list of problems; empty means valid.
 */
export function validateLessonsFile(text) {
  const problems = [];
  if (!parseCursor(text))
    problems.push('line 1 is not a `reviewed-through` cursor');

  const lessons = parseLessons(text);
  const keys = new Set();
  for (const lesson of lessons) {
    if (keys.has(lesson.key))
      problems.push(`duplicate lesson: ${lesson.title}`);
    keys.add(lesson.key);

    const lines = text.split('\n');
    const declared = SEEN_RE.exec(lines[lesson.seenLine]);
    const declaredCount = Number(declared[1]);
    const dates = lesson.seenDates;
    if (dates.some((d) => !isUtcDate(d))) {
      problems.push(`non-UTC-date in Seen line: ${lesson.title}`);
    }
    if (new Set(dates).size !== dates.length) {
      problems.push(`repeated review day in Seen line: ${lesson.title}`);
    }
    if (declaredCount !== dates.length) {
      problems.push(
        `Seen count ${declaredCount}x does not match ${dates.length} listed day(s): ${lesson.title}`,
      );
    }
    const sorted = [...dates].sort();
    if (sorted.join() !== dates.join()) {
      problems.push(`Seen dates are not in order: ${lesson.title}`);
    }
    const bullets = lines
      .slice(lesson.bodyStart, lesson.end)
      .filter((l) => l.startsWith('- ') && !SEEN_RE.test(l));
    if (bullets.length === 0)
      problems.push(`lesson has no evidence bullet: ${lesson.title}`);
  }
  return problems;
}
