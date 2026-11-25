// Slice scope enforcement for #365.
//
// A slice may edit the files its approved brief lists under "Owned files", plus
// the shared files it lists under "Shared files". Everything else fails closed.
// The owned and shared lists are read from the brief revision whose digest the
// maintainer approved, never from the worker or from issue text.
//
// #362's patch policy runs on top, unchanged. A brief cannot authorize a path on
// the hard deny-list, so a slice that "owns" `.github/ci.yml` still fails.

import {
  evaluatePatchPolicy,
  normalizeRepoPath,
} from '../bug-publisher/index.mjs';
import { isSharedFile } from '../feature-brief/brief.mjs';

const GLOB = /[*?[\]]/;

function violation(rule, detail, filePath) {
  return { rule, detail, path: filePath };
}

/** `entry` names a file or a directory; a directory covers everything below it. */
function covers(entry, filePath) {
  return filePath === entry || filePath.startsWith(`${entry}/`);
}

function normalizeDeclared(list, label, violations) {
  const entries = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const result = normalizeRepoPath(raw);
    if (!result.ok) {
      violations.push(
        violation(
          'scope-invalid-path',
          `${label}: ${result.reason}`,
          String(raw),
        ),
      );
      continue;
    }
    if (GLOB.test(result.path)) {
      violations.push(
        violation(
          'scope-glob-unsupported',
          `${label} must name exact files or directories, not globs`,
          result.path,
        ),
      );
      continue;
    }
    entries.push(result.path);
  }
  return entries;
}

/**
 * Decide whether a patch stays inside its slice.
 *
 * `changedFiles` must come from the trusted caller's `baseSha..localHead` diff.
 * A rename lists both paths, and both must be in scope.
 */
export function evaluateSliceScope({
  owned,
  shared,
  changedFiles,
  componentSizeBase,
  componentSizeHead,
  warningBaselineBase,
  warningBaselineHead,
} = {}) {
  const violations = [];
  const ownedEntries = normalizeDeclared(owned, 'Owned files', violations);
  const sharedEntries = normalizeDeclared(shared, 'Shared files', violations);
  if (ownedEntries.length === 0) {
    violations.push(
      violation('scope-owned-missing', 'the slice declares no owned files'),
    );
  }
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    violations.push(
      violation('scope-changed-files-missing', 'no trusted changed-file list'),
    );
    return {
      ok: false,
      outcome: 'paused-out-of-scope',
      violations,
      changedFiles: [],
    };
  }

  // The hard deny-list, manifest authorization, and frozen-debt ceilings are
  // #362's. The scheduled shared files are the only paths this brief authorizes.
  const policy = evaluatePatchPolicy({
    changedFiles,
    authorizedPaths: sharedEntries,
    componentSizeBase,
    componentSizeHead,
    warningBaselineBase,
    warningBaselineHead,
  });
  violations.push(...policy.violations);

  for (const filePath of policy.changedFiles) {
    if (isSharedFile(filePath)) {
      if (!sharedEntries.some((entry) => covers(entry, filePath))) {
        violations.push(
          violation(
            'unscheduled-shared-file',
            'a shared file must be listed under the slice "Shared files"',
            filePath,
          ),
        );
      }
      continue;
    }
    const inScope =
      ownedEntries.some((entry) => covers(entry, filePath)) ||
      sharedEntries.some((entry) => covers(entry, filePath));
    if (!inScope) {
      violations.push(
        violation(
          'out-of-scope',
          'the file is not owned or scheduled by this slice',
          filePath,
        ),
      );
    }
  }

  return {
    ok: violations.length === 0,
    outcome: violations.length === 0 ? 'in-scope' : 'paused-out-of-scope',
    violations,
    changedFiles: policy.changedFiles,
  };
}

function reaches(slicesById, fromId, toId, seen = new Set()) {
  if (seen.has(fromId)) return false;
  seen.add(fromId);
  const slice = slicesById.get(fromId);
  for (const dependency of slice?.depends ?? []) {
    if (dependency === toId || reaches(slicesById, dependency, toId, seen)) {
      return true;
    }
  }
  return false;
}

/**
 * Block merge while two pending slices touch the same shared file without a
 * dependency order, or while a slice touches a shared file it did not schedule.
 * `slices` is `validateBrief(...).brief.slices`; `pending` lists each open slice
 * with its trusted changed files.
 */
export function checkMergeSerialization({ slices, pending } = {}) {
  const blockers = [];
  const slicesById = new Map(
    (Array.isArray(slices) ? slices : []).map((slice) => [slice.id, slice]),
  );
  const touching = new Map();

  for (const entry of Array.isArray(pending) ? pending : []) {
    const slice = slicesById.get(entry?.sliceId);
    if (!slice) {
      blockers.push({
        rule: 'unknown-slice',
        slices: [String(entry?.sliceId)],
      });
      continue;
    }
    const scheduled = normalizeDeclared(slice.shared, 'Shared files', []);
    for (const raw of entry.changedFiles ?? []) {
      const normalized = normalizeRepoPath(
        typeof raw === 'string' ? raw : raw?.path,
      );
      if (!normalized.ok || !isSharedFile(normalized.path)) continue;
      if (!scheduled.some((candidate) => covers(candidate, normalized.path))) {
        blockers.push({
          rule: 'unscheduled-shared-file',
          path: normalized.path,
          slices: [slice.id],
        });
      }
      const owners = touching.get(normalized.path) ?? new Set();
      owners.add(slice.id);
      touching.set(normalized.path, owners);
    }
  }

  for (const [filePath, owners] of touching) {
    const ids = [...owners].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const ordered =
          reaches(slicesById, ids[i], ids[j]) ||
          reaches(slicesById, ids[j], ids[i]);
        if (!ordered) {
          blockers.push({
            rule: 'unserialized-shared-file',
            path: filePath,
            slices: [ids[i], ids[j]],
          });
        }
      }
    }
  }

  return {
    ok: blockers.length === 0,
    outcome: blockers.length === 0 ? 'serialized' : 'blocked-until-serialized',
    blockers,
  };
}
