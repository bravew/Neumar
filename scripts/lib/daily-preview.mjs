/**
 * Pure decision logic for the daily desktop preview (#366).
 *
 * Nothing here touches the network, the filesystem, or the environment, so every
 * rule can be tested with fixtures. `scripts/daily-preview.mjs` is the thin CLI
 * the workflow calls. A failed or incomplete read is "unknown", never "empty":
 * every function that cannot prove its answer throws rather than guessing.
 */

/** The aggregate check from `.github/workflows/ci.yml`, produced by GitHub Actions. */
export const GATE_CHECK_NAME = 'CI Gate';
export const GATE_APP_ID = 15368;

/** Durable pointer branch and file. The pointer only moves after verification. */
export const POINTER_BRANCH = 'state/daily-preview';
export const POINTER_FILE = 'last-good.json';

const FULL_SHA = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isFullSha(value) {
  return typeof value === 'string' && FULL_SHA.test(value);
}

function assertFullSha(value, label) {
  if (!isFullSha(value)) {
    throw new Error(`${label} must be a 40-character lowercase commit SHA`);
  }
}

/**
 * Parse the contents of `last-good.json`. Throws on anything malformed so a
 * corrupt pointer is never treated as "no previous build".
 */
export function parsePointer(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`last-good pointer is not valid JSON: ${error.message}`);
  }
  if (typeof data !== 'object' || data === null || data.schema !== 1) {
    throw new Error('last-good pointer has an unsupported schema');
  }
  assertFullSha(data.sha, 'last-good pointer sha');
  for (const key of ['advancedAt', 'runUrl', 'artifact']) {
    if (typeof data[key] !== 'string' || data[key] === '') {
      throw new Error(`last-good pointer is missing "${key}"`);
    }
  }
  return {
    schema: 1,
    sha: data.sha,
    advancedAt: data.advancedAt,
    runUrl: data.runUrl,
    artifact: data.artifact,
  };
}

/**
 * Creation order. `started_at` is null while a run is queued, and an empty string
 * would sort *before* every real timestamp, hiding a newer pending run behind an
 * older success. Fall back to `created_at`, which the API always sets, and use the
 * numeric id as the last resort.
 */
function runOrder(a, b) {
  const key = (run) => String(run.created_at ?? run.started_at ?? '');
  const byCreation = key(a).localeCompare(key(b));
  return byCreation !== 0 ? byCreation : Number(a.id ?? 0) - Number(b.id ?? 0);
}

/**
 * Decide whether `CI Gate` passed on exactly `sha`.
 *
 * `payload` is the body of `GET /repos/{repo}/commits/{sha}/check-runs`. The
 * most recently created `CI Gate` run from the GitHub Actions app on that exact
 * commit decides, so a pending re-run blocks an older success.
 * A truncated or malformed response is `unknown`, which is a failure.
 *
 * @returns {{ ok: true } | { ok: false, state: 'unknown'|'missing'|'pending'|'failed', detail: string }}
 */
export function evaluateCiGate(payload, sha) {
  assertFullSha(sha, 'candidate sha');
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray(payload.check_runs) ||
    typeof payload.total_count !== 'number'
  ) {
    return {
      ok: false,
      state: 'unknown',
      detail: 'check-runs response was malformed',
    };
  }
  if (payload.check_runs.length < payload.total_count) {
    return {
      ok: false,
      state: 'unknown',
      detail: `check-runs response was truncated (${payload.check_runs.length} of ${payload.total_count})`,
    };
  }

  const gates = payload.check_runs
    .filter(
      (run) =>
        run?.name === GATE_CHECK_NAME &&
        run?.app?.id === GATE_APP_ID &&
        run?.head_sha === sha,
    )
    .sort(runOrder);
  if (gates.length === 0) {
    return {
      ok: false,
      state: 'missing',
      detail: `no "${GATE_CHECK_NAME}" check from app ${GATE_APP_ID} on ${sha}`,
    };
  }

  const latest = gates[gates.length - 1];
  if (latest.status !== 'completed') {
    return {
      ok: false,
      state: 'pending',
      detail: `"${GATE_CHECK_NAME}" is ${latest.status}`,
    };
  }
  if (latest.conclusion !== 'success') {
    return {
      ok: false,
      state: 'failed',
      detail: `"${GATE_CHECK_NAME}" concluded ${latest.conclusion}`,
    };
  }
  return { ok: true };
}

/**
 * Decide what the run does. `no-change` is checked first so an unchanged `main`
 * never depends on the GitHub API and never starts a macOS runner.
 *
 * @returns {{ action: 'build'|'no-change'|'abort', reason: string, range: string }}
 */
export function decidePlan({ candidateSha, lastGoodSha, ci }) {
  assertFullSha(candidateSha, 'candidate sha');
  const hasPrevious = lastGoodSha !== null && lastGoodSha !== undefined;
  if (hasPrevious) assertFullSha(lastGoodSha, 'last-good sha');

  const range = hasPrevious
    ? `${lastGoodSha}..${candidateSha}`
    : `initial..${candidateSha}`;

  if (hasPrevious && lastGoodSha === candidateSha) {
    return { action: 'no-change', reason: 'main has not moved', range };
  }
  if (!ci?.ok) {
    return {
      action: 'abort',
      reason: `ci-${ci?.state ?? 'unknown'}: ${ci?.detail ?? 'no CI evidence'}`,
      range,
    };
  }
  return { action: 'build', reason: 'new verified commits', range };
}

/** `YYYY-MM-DD-<short sha>`, unique per day and commit. */
export function artifactBaseName({ date, sha }) {
  if (!DATE.test(date ?? '')) throw new Error('date must be YYYY-MM-DD');
  assertFullSha(sha, 'sha');
  return `${date}-${sha.slice(0, 7)}`;
}

/**
 * Compute the next pointer. Moves only for a verified build, and only when the
 * pointer still holds the value the plan read (compare and set), so an
 * out-of-order or duplicate run can never move it backwards.
 */
export function nextPointer({
  current,
  expectedPrevious,
  candidateSha,
  verified,
  now,
  runUrl,
  artifact,
}) {
  assertFullSha(candidateSha, 'candidate sha');
  if (verified !== true) {
    throw new Error('refusing to advance the pointer: build was not verified');
  }
  const currentSha = current?.sha ?? null;
  if (currentSha === candidateSha) return current;
  if (currentSha !== (expectedPrevious ?? null)) {
    throw new Error(
      `pointer moved since the plan read it (expected ${expectedPrevious ?? 'none'}, found ${currentSha ?? 'none'})`,
    );
  }
  return {
    schema: 1,
    sha: candidateSha,
    advancedAt: now,
    runUrl,
    artifact,
  };
}

/**
 * Parse `SHA256SUMS` (`<64 hex>  <name>` per line). Throws on a malformed line.
 */
export function parseSha256Sums(text) {
  const entries = new Map();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!match) throw new Error(`malformed SHA256SUMS line: ${line}`);
    if (entries.has(match[2])) {
      throw new Error(`duplicate SHA256SUMS entry: ${match[2]}`);
    }
    entries.set(match[2], match[1]);
  }
  return entries;
}

/**
 * Compare a `SHA256SUMS` listing with hashes computed from the downloaded files.
 * Missing, corrupted, and unlisted files are all problems. An empty listing is
 * a problem too.
 *
 * @param {string} sumsText
 * @param {Record<string, string>} actual file name to computed sha256
 */
export function checkChecksums(sumsText, actual) {
  const problems = [];
  let expected;
  try {
    expected = parseSha256Sums(sumsText);
  } catch (error) {
    return { ok: false, problems: [error.message] };
  }
  if (expected.size === 0) problems.push('SHA256SUMS lists no files');
  for (const [name, hash] of expected) {
    if (!(name in actual)) problems.push(`missing file: ${name}`);
    else if (actual[name] !== hash) problems.push(`checksum mismatch: ${name}`);
  }
  for (const name of Object.keys(actual)) {
    if (!expected.has(name)) problems.push(`unlisted file: ${name}`);
  }
  return { ok: problems.length === 0, problems };
}
