// Reviewed Feature Brief: canonical format, parser, and structural validator.
//
// A raw `enhancement` issue is an intake request. A feature worker may claim work
// only against a brief that passes validateBrief() and carries a maintainer
// approval bound to digestBrief() (see approval.mjs). The format is Markdown so a
// brief can live in the issue body or on the epic branch; nothing here reads the
// network or the filesystem.

import { createHash } from 'node:crypto';

// Locales that user-facing text must cover (AGENTS.md, "Implementation conventions").
export const LOCALES = ['en', 'zh', 'es', 'fr', 'hi', 'pt'];

// A caller-level surface. Inner-unit-only evidence is not acceptance evidence
// (LESSONS.md, "A unit test that stops short of the real boundary does not prove
// the feature").
export const SURFACES = ['http-route', 'mcp-handler', 'tauri-ipc', 'ui-flow'];

// Files that LESSONS.md says must be serialized across parallel work. A slice that
// edits one must list it under "Shared files" so the edit is scheduled, not found
// later as a merge conflict.
const SHARED_FILE_EXACT = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'scripts/component-size-allowlist.json',
  'src-api/src/http-daemon.ts',
  'src-api/src/shared/mcp/video-edit-server.ts',
]);
const SHARED_FILE_PREFIXES = [
  'src/config/locale/messages/',
  'packages/video-ir/',
];

// `./package.json` and `src//x.ts` name the same file as their canonical forms, so
// classify and validate the canonical spelling. Paths are repository-relative.
export function normalizeRepoPath(path) {
  return path
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

export function isSharedFile(path) {
  const canonical = normalizeRepoPath(path);
  return (
    SHARED_FILE_EXACT.has(canonical) ||
    SHARED_FILE_PREFIXES.some((prefix) => canonical.startsWith(prefix))
  );
}

// CommonMark fences open with at least three backticks or tildes. A closing fence
// uses the same character, is at least as long, and carries no info string. A
// three-backtick line inside a four-backtick fence is content, not a close.
export function trackFence(line, fence) {
  const opening = /^\s*(`{3,}|~{3,})/.exec(line);
  if (!opening) return { fence, isFenceLine: false };
  if (!fence) {
    return {
      fence: { char: opening[1][0], length: opening[1].length },
      isFenceLine: true,
    };
  }
  const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  if (
    closing &&
    closing[1][0] === fence.char &&
    closing[1].length >= fence.length
  ) {
    return { fence: null, isFenceLine: true };
  }
  return { fence, isFenceLine: true };
}

export const EPIC_BRANCH = /^epic\/\d+-[a-z0-9][a-z0-9-]*$/;
const SLICE_ID = /^S\d+$/;
const GITHUB_LOGIN = /^@?[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const PLACEHOLDER = /^(?:tbd|todo|\?+|n\/a|na|-|…|\.\.\.)$/i;

// Heading, key, and the one question to ask when the section is missing or empty.
export const REQUIRED_SECTIONS = [
  {
    key: 'outcome',
    heading: 'User outcome',
    question:
      'What should a user be able to do after this ships, in one or two sentences?',
  },
  {
    key: 'nonGoals',
    heading: 'Non-goals',
    question: 'What is explicitly out of scope for this feature?',
  },
  {
    key: 'owner',
    heading: 'Accountable owner',
    question:
      'Which human collaborator (GitHub login) is accountable for this design?',
  },
  {
    key: 'acceptance',
    heading: 'Acceptance criteria',
    question: `Which surface proves each criterion (${SURFACES.join(', ')})?`,
  },
  {
    key: 'platform',
    heading: 'Platform, branding and i18n',
    question:
      'Does this add user-facing text, and which platforms and branding values does it touch?',
  },
  {
    key: 'security',
    heading: 'Security and boundaries',
    question:
      'Which boundaries does this touch (safeFetch, path-validator, getAppDir, Tauri capabilities), or none?',
  },
  {
    key: 'slices',
    heading: 'Slices',
    question:
      'What are the ordered slices, and which files does each slice own?',
  },
];

// Same bytes in, same digest out, regardless of editor line endings or trailing
// whitespace. Anything that changes meaning still changes the digest.
export function canonicalizeBrief(text) {
  const normalized = String(text)
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  return `${normalized}\n`;
}

export function digestBrief(text) {
  return createHash('sha256')
    .update(canonicalizeBrief(text), 'utf8')
    .digest('hex');
}

function splitSections(lines) {
  const header = [];
  const sections = new Map();
  let current = null;
  let fence = null;
  for (const line of lines) {
    const tracked = trackFence(line, fence);
    fence = tracked.fence;
    if (tracked.isFenceLine) continue;
    const heading = !fence && /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { title: heading[1], lines: [] };
      sections.set(heading[1].toLowerCase(), current);
    } else if (current) {
      current.lines.push(line);
    } else {
      header.push(line);
    }
  }
  return { header, sections };
}

// A bullet or quote marker is formatting, not content: `- TBD` is still a
// placeholder and must not satisfy a required section.
function meaningful(lines) {
  return lines
    .map((line) => line.trim().replace(/^(?:[-*+]\s+|>\s*)+/, ''))
    .filter((line) => line && !PLACEHOLDER.test(line));
}

function bullets(lines) {
  return lines
    .map((line) => /^\s*[-*]\s+(.*\S)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

function fileList(value) {
  const trimmed = value.trim();
  if (!trimmed || /^none$/i.test(trimmed)) return [];
  return trimmed
    .split(',')
    .map((item) => normalizeRepoPath(item.trim().replace(/^`|`$/g, '')))
    .filter(Boolean);
}

function parseSlices(lines) {
  const slices = [];
  let current = null;
  for (const line of lines) {
    const heading = /^###\s+(S\d+)\s*[:-]\s*(.+?)\s*$/.exec(line);
    if (heading) {
      current = { id: heading[1], title: heading[2], fields: {} };
      slices.push(current);
      continue;
    }
    const field = current && /^\s*[-*]\s+([A-Za-z ]+?):\s*(.*)$/.exec(line);
    if (field) current.fields[field[1].trim().toLowerCase()] = field[2];
  }
  return slices;
}

// Returns { ok, errors, brief }. Each error is { code, message, question } so a
// caller can ask exactly one concrete question instead of guessing.
export function validateBrief(text) {
  const errors = [];
  const fail = (code, message, question) =>
    errors.push({ code, message, question });

  if (typeof text !== 'string' || !text.trim()) {
    fail(
      'empty-brief',
      'There is no brief.',
      'Please add a Reviewed Feature Brief (see doc/maintenance/feature-brief-process.md).',
    );
    return { ok: false, errors, brief: null };
  }

  const { header, sections } = splitSections(
    canonicalizeBrief(text).split('\n'),
  );
  const epicLine = header
    .map((line) => /^Epic branch:\s*(\S+)\s*$/i.exec(line))
    .find(Boolean);
  const epicBranch = epicLine?.[1].replace(/^`|`$/g, '') ?? null;
  if (!epicBranch || !EPIC_BRANCH.test(epicBranch)) {
    fail(
      'epic-branch',
      'The header needs "Epic branch: epic/<N>-<slug>".',
      'Which epic branch (epic/<N>-<slug>) should the slices target?',
    );
  }

  const brief = { epicBranch, sections: {}, slices: [] };
  for (const spec of REQUIRED_SECTIONS) {
    const section = sections.get(spec.heading.toLowerCase());
    const body = section ? meaningful(section.lines) : [];
    if (body.length === 0) {
      fail(
        'missing-section',
        `Section "${spec.heading}" is missing or empty.`,
        spec.question,
      );
      continue;
    }
    brief.sections[spec.key] = section.lines;
  }

  const ownerLines = brief.sections.owner
    ? meaningful(brief.sections.owner)
    : [];
  if (ownerLines.length > 0) {
    const login = ownerLines[0].replace(/^[-*]\s+/, '');
    if (!GITHUB_LOGIN.test(login)) {
      fail(
        'owner',
        '"Accountable owner" must be a single GitHub login.',
        'Which human collaborator (GitHub login) is accountable for this design?',
      );
    } else {
      brief.owner = login.replace(/^@/, '');
    }
  }

  if (brief.sections.acceptance) {
    const criteria = bullets(brief.sections.acceptance);
    if (criteria.length === 0) {
      fail(
        'acceptance',
        'Acceptance criteria must be a bullet list.',
        `Which surface (${SURFACES.join(', ')}) proves each criterion?`,
      );
    }
    for (const criterion of criteria) {
      const tag = /^\[([a-z-]+)\]\s+\S/.exec(criterion);
      if (!tag || !SURFACES.includes(tag[1])) {
        fail(
          'acceptance-surface',
          `Criterion "${criterion}" must start with a surface tag: ${SURFACES.map((s) => `[${s}]`).join(' ')}.`,
          `Which caller-level surface (${SURFACES.join(', ')}) proves "${criterion}"?`,
        );
      }
    }
    brief.acceptance = criteria;
  }

  if (brief.sections.platform) {
    const body = brief.sections.platform.join('\n');
    const flag = /^\s*(?:[-*]\s+)?User-facing text:\s*(yes|no)\s*$/im.exec(
      body,
    );
    if (!flag) {
      fail(
        'user-facing-flag',
        '"Platform, branding and i18n" needs a "User-facing text: yes|no" line.',
        'Does this feature add or change user-facing text (yes or no)?',
      );
    } else if (flag[1].toLowerCase() === 'yes') {
      const missing = LOCALES.filter(
        (locale) => !new RegExp(`\\b${locale}\\b`).test(body),
      );
      if (missing.length > 0) {
        fail(
          'locales',
          `User-facing text needs all six locales; missing: ${missing.join(', ')}.`,
          `Please confirm translations for ${missing.join(', ')} are in scope.`,
        );
      }
      brief.userFacing = true;
    } else {
      brief.userFacing = false;
    }
  }

  if (brief.sections.slices) {
    const slices = parseSlices(brief.sections.slices);
    const seen = new Set();
    if (slices.length === 0) {
      fail(
        'slices',
        'Slices must use "### S1: title" headings.',
        'What are the ordered slices, and which files does each slice own?',
      );
    }
    for (const slice of slices) {
      const label = `Slice ${slice.id}`;
      const owned = fileList(slice.fields['owned files'] ?? '');
      const hasSharedField = 'shared files' in slice.fields;
      const hasDependsField = 'depends on' in slice.fields;
      const shared = fileList(slice.fields['shared files'] ?? '');
      const depends = fileList(slice.fields['depends on'] ?? '');

      if (!SLICE_ID.test(slice.id) || seen.has(slice.id)) {
        fail(
          'slice-id',
          `${label} id is not unique.`,
          'Please give each slice a unique id.',
        );
      }
      if (owned.length === 0) {
        fail(
          'slice-owned',
          `${label} has no "Owned files".`,
          `Which files does ${slice.id} own?`,
        );
      }
      if (!hasSharedField) {
        fail(
          'slice-shared',
          `${label} must state "Shared files" (use "none" if there are none).`,
          `Does ${slice.id} edit any shared file (package.json, lockfile, locale modules, size allowlist, http-daemon.ts, video-edit-server.ts, packages/video-ir)?`,
        );
      }
      if (!hasDependsField) {
        fail(
          'slice-depends-missing',
          `${label} must state "Depends on" (use "none" if it depends on nothing).`,
          `Which earlier slice must ${slice.id} wait for, or none?`,
        );
      }
      for (const path of [...owned, ...shared]) {
        if (path.startsWith('/') || path.split('/').includes('..')) {
          fail(
            'slice-path',
            `${label} path "${path}" must be repository-relative.`,
            `What is the repository-relative path for "${path}" in ${slice.id}?`,
          );
        }
      }
      for (const path of owned) {
        if (isSharedFile(path)) {
          fail(
            'slice-shared-owned',
            `${label} lists shared file "${path}" under Owned files.`,
            `Should ${slice.id}'s edit to "${path}" be scheduled under Shared files?`,
          );
        }
      }
      for (const dependency of depends) {
        if (!seen.has(dependency)) {
          fail(
            'slice-depends',
            `${label} depends on "${dependency}", which is not an earlier slice.`,
            `Which earlier slice must ${slice.id} wait for?`,
          );
        }
      }
      seen.add(slice.id);
      brief.slices.push({
        id: slice.id,
        title: slice.title,
        owned,
        shared,
        depends,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    brief: errors.length === 0 ? brief : null,
  };
}
