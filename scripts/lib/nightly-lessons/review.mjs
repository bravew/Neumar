/**
 * Turns collector findings into LESSONS.md changes and a report.
 *
 * Only two things can edit LESSONS.md here: a finding whose detector names an
 * existing lesson, and an explicit proposal file. Both pass the evidence
 * validator first, and both go through the idempotent `applyEvidence` and
 * `addLesson`, so replaying a range writes nothing the second time.
 *
 * Findings with no lesson of their own (reverts, fix-forward commits, reopened
 * issues) are reported as candidates. Naming the failure pattern is judgment,
 * and automation does not make it.
 */

import { validateProposal } from './evidence.mjs';
import {
  addLesson,
  applyEvidence,
  parseLessons,
  promotionCandidates,
  setCursor,
  validateLessonsFile,
} from './lessons-file.mjs';

/** One lesson gets at most this many evidence bullets from a single run. */
export const MAX_BULLETS_PER_LESSON = 3;

export function planFromFindings(findings, lessonsText, reviewDate) {
  const lessons = parseLessons(lessonsText);
  const perLesson = new Map();
  const proposals = [];
  const candidates = [];
  const overflow = [];

  for (const found of findings) {
    const lesson = found.lessonPrefix
      ? lessons.find((l) => l.key.startsWith(found.lessonPrefix))
      : undefined;
    if (!lesson) {
      candidates.push(found);
      continue;
    }
    const used = perLesson.get(lesson.key) ?? 0;
    if (used >= MAX_BULLETS_PER_LESSON) {
      overflow.push(found);
      continue;
    }
    perLesson.set(lesson.key, used + 1);
    proposals.push({
      kind: 'increment',
      lessonKey: lesson.key,
      reviewDate,
      refs: found.refs,
      summary: found.summary,
      ran: found.ran,
      missed: found.missed,
    });
  }
  return { proposals, candidates, overflow };
}

export function applyProposals(lessonsText, proposals) {
  let text = lessonsText;
  const applied = [];
  const replays = [];
  const rejected = [];

  for (const raw of proposals) {
    const checked = validateProposal(raw);
    if (!checked.ok) {
      rejected.push({ proposal: raw, problems: checked.problems });
      continue;
    }
    const proposal = checked.proposal;
    try {
      const result =
        proposal.kind === 'new'
          ? addLesson(text, proposal)
          : applyEvidence(text, proposal.lessonKey, proposal);
      text = result.text;
      (result.changed ? applied : replays).push(proposal);
    } catch (error) {
      rejected.push({ proposal: raw, problems: [error.message] });
    }
  }

  const problems = validateLessonsFile(text);
  if (problems.length > 0) {
    // Never hand back a file the structural check would reject.
    throw new Error(`proposed LESSONS.md is invalid: ${problems.join('; ')}`);
  }
  return { text, applied, replays, rejected };
}

/** Run the whole decision: plan, apply, or catch up. */
export function reviewRange({
  lessonsText,
  collected,
  reviewDate,
  extraProposals = [],
  catchUp = false,
}) {
  if (!collected.complete) {
    // No plan, no edits, no cursor move. The caller reports the reasons.
    return {
      text: lessonsText,
      changed: false,
      applied: [],
      replays: [],
      rejected: [],
      candidates: [],
      overflow: [],
      promotions: promotionCandidates(lessonsText),
    };
  }

  if (catchUp) {
    // One-time (or on-request) catch-up: a person reviews the whole gap, so
    // nothing is written as evidence. Every finding is a candidate, and only
    // the cursor moves. Entries already in LESSONS.md stay exactly as they are.
    const moved =
      collected.range.commits > 0
        ? setCursor(lessonsText, collected.range.head, reviewDate)
        : lessonsText;
    return {
      text: moved,
      changed: moved !== lessonsText,
      applied: [],
      replays: [],
      rejected: [],
      candidates: collected.findings,
      overflow: [],
      promotions: promotionCandidates(lessonsText),
    };
  }

  const plan = planFromFindings(collected.findings, lessonsText, reviewDate);
  const result = applyProposals(lessonsText, [
    ...plan.proposals,
    ...extraProposals,
  ]);
  let text = result.text;
  const lessonsChanged = text !== lessonsText;
  if (lessonsChanged) {
    text = setCursor(text, collected.range.head, reviewDate);
  }
  return {
    text,
    changed: text !== lessonsText,
    applied: result.applied,
    replays: result.replays,
    rejected: result.rejected,
    candidates: plan.candidates,
    overflow: plan.overflow,
    promotions: promotionCandidates(text),
  };
}

/** Untrusted text goes into a code span, on one line, with no @mentions live. */
export function inline(value, limit = 120) {
  const flat = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/`/g, "'")
    .trim();
  const clipped = flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
  return `\`${clipped}\``;
}

export function renderReport({ date, collected, outcome, catchUp }) {
  const { range } = collected;
  const lines = [`# Nightly lessons review, ${date}`, ''];
  lines.push(
    `Range: ${inline(`${range.base.slice(0, 8)}..${range.head.slice(0, 8)}`)} (first parent, ${range.commits} commit(s))`,
  );

  if (!collected.complete) {
    lines.push(
      '',
      '**Incomplete. The cursor was not advanced and nothing was proposed.**',
      '',
    );
    for (const reason of collected.reasons)
      lines.push(`- ${inline(reason, 300)}`);
    return `${lines.join('\n')}\n`;
  }

  if (range.commits === 0) {
    lines.push('', 'Quiet day: no new commits on `main` since the cursor.');
    return `${lines.join('\n')}\n`;
  }

  if (catchUp) {
    lines.push(
      '',
      '**Catch-up run.** No lesson was written. The cursor moves to the head, and every finding below is for a person to review.',
    );
  }

  const gateCounts = collected.commits.reduce((acc, c) => {
    acc[c.gate] = (acc[c.gate] ?? 0) + 1;
    return acc;
  }, {});
  lines.push(
    '',
    `CI Gate on merged commits: ${Object.entries(gateCounts)
      .map(([state, n]) => `${state} ${n}`)
      .join(', ')}.`,
  );

  lines.push('', '## Lesson changes', '');
  if (outcome.applied.length === 0) {
    lines.push('None. No finding added new evidence to an existing lesson.');
  }
  for (const item of outcome.applied) {
    lines.push(
      `- ${item.kind === 'new' ? 'New lesson' : 'Evidence'}: ${inline(item.summary, 200)} (${item.refs.map((r) => inline(r)).join(', ')})`,
    );
  }
  if (outcome.replays.length > 0) {
    lines.push(
      '',
      `Already recorded, left unchanged: ${outcome.replays.length}.`,
    );
  }
  if (outcome.overflow.length > 0) {
    lines.push(
      '',
      `Not written (more than ${MAX_BULLETS_PER_LESSON} for one lesson in one run): ${outcome.overflow.length}. See the candidates below.`,
    );
  }
  for (const item of outcome.rejected) {
    lines.push(`- Rejected: ${inline(item.problems.join('; '), 300)}`);
  }

  const candidates = [...outcome.candidates, ...outcome.overflow];
  lines.push('', '## Candidates for a person to classify', '');
  if (candidates.length === 0) lines.push('None.');
  for (const item of candidates) {
    lines.push(
      `- ${item.detector}: ${inline(item.summary, 200)} (${item.refs.map((r) => inline(r)).join(', ')})`,
    );
    if (item.guard)
      lines.push(`  - Existing guard to check: ${inline(item.guard, 200)}`);
  }

  lines.push('', '## Promotion', '');
  if (outcome.promotions.length === 0) {
    lines.push('No lesson has three distinct UTC review days.');
  }
  for (const item of outcome.promotions) {
    lines.push(
      `- Propose moving ${inline(item.title, 160)} into AGENTS.md: ${item.days} distinct review days. A person edits AGENTS.md and leaves a pointer in LESSONS.md.`,
    );
  }
  return `${lines.join('\n')}\n`;
}
