// Verification-report contract for #362's worker and publisher.
//
// The worker produces this report; the publisher refuses to push or open a PR
// unless every field the runbook promises is present and consistent with the
// exact head SHA, the pinned base SHA, and the changed files.

import { normalizeRepoPath } from './policy.mjs';

import os from 'node:os';
import path from 'node:path';

export const REPORT_VERSION = 1;

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const CLOSING_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;

export function isGitSha(value) {
  return typeof value === 'string' && SHA.test(value);
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Issues a PR body says it closes, in the order they first appear. */
export function findClosingIssues(body) {
  if (typeof body !== 'string') return [];
  const found = [];
  for (const match of body.matchAll(CLOSING_KEYWORD)) {
    const issue = Number(match[1]);
    if (!found.includes(issue)) found.push(issue);
  }
  return found;
}

/** Commands the closest workspace checks require for a changed-file set. */
export function requiredChecksForFiles(changedFiles = []) {
  const checks = new Set(['pnpm validate']);
  const touches = (prefix) =>
    changedFiles.some((file) => file === prefix || file.startsWith(prefix));

  if (touches('src-api/')) {
    checks.add('pnpm --filter neumar-api lint');
    checks.add('pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit');
  }
  if (touches('packages/video-ir/')) {
    checks.add('pnpm --filter @neumar/video-ir validate');
    checks.add('pnpm --filter @neumar/video-ir test');
  }
  if (touches('src-video/')) {
    checks.add('pnpm --filter @neumar/video validate');
  }
  if (touches('src-tauri/')) {
    checks.add('cargo check --manifest-path src-tauri/Cargo.toml --locked');
    checks.add('cargo fmt --manifest-path src-tauri/Cargo.toml --check');
  }
  return [...checks];
}

function violation(rule, detail, field) {
  return { rule, detail, field };
}

function isInsideHome(directory) {
  if (!isNonEmptyString(directory) || !path.isAbsolute(directory)) {
    return false;
  }
  const resolved = path.resolve(directory);
  const home = path.resolve(os.homedir());
  return resolved === home || resolved.startsWith(`${home}${path.sep}`);
}

function checkStringArray(
  value,
  field,
  violations,
  { allowEmpty = false } = {},
) {
  if (!Array.isArray(value)) {
    violations.push(violation('field-shape', 'must be an array', field));
    return [];
  }
  if (!allowEmpty && value.length === 0) {
    violations.push(violation('field-empty', 'must not be empty', field));
  }
  for (const [index, entry] of value.entries()) {
    if (!isNonEmptyString(entry)) {
      violations.push(
        violation('field-shape', `entry ${index} must be a string`, field),
      );
    }
  }
  return value;
}

function validateRegression(regression, expected, violations) {
  if (!regression || typeof regression !== 'object') {
    violations.push(
      violation('field-shape', 'regression evidence is required', 'regression'),
    );
    return;
  }
  const testPath = normalizeRepoPath(regression.testPath);
  if (!testPath.ok) {
    violations.push(
      violation('regression-path', testPath.reason, 'regression.testPath'),
    );
  }
  if (!isNonEmptyString(regression.command)) {
    violations.push(
      violation(
        'regression-command',
        'the exact regression command is required',
        'regression.command',
      ),
    );
  }
  if (!isNonEmptyString(regression.callerBoundary)) {
    violations.push(
      violation(
        'regression-caller',
        'name the real caller boundary the test exercises',
        'regression.callerBoundary',
      ),
    );
  }
  if (regression.failsOnBase !== true) {
    violations.push(
      violation(
        'regression-not-failing-on-base',
        'the regression test must fail on the pinned base SHA',
        'regression.failsOnBase',
      ),
    );
  }
  if (regression.passesOnHead !== true) {
    violations.push(
      violation(
        'regression-not-passing-on-head',
        'the regression test must pass on the proposed head SHA',
        'regression.passesOnHead',
      ),
    );
  }
  if (regression.baseSha !== expected.baseSha) {
    violations.push(
      violation(
        'regression-base-mismatch',
        'regression evidence is for a different base SHA',
        'regression.baseSha',
      ),
    );
  }
  if (regression.headSha !== expected.headSha) {
    violations.push(
      violation(
        'regression-head-mismatch',
        'regression evidence is for a different head SHA',
        'regression.headSha',
      ),
    );
  }
}

function validateSanitization(sanitization, violations) {
  if (!sanitization || typeof sanitization !== 'object') {
    violations.push(
      violation(
        'field-shape',
        'sanitization evidence is required',
        'sanitization',
      ),
    );
    return;
  }
  if (
    !isNonEmptyString(sanitization.appDataDir) ||
    !path.isAbsolute(sanitization.appDataDir)
  ) {
    violations.push(
      violation(
        'sanitization-app-data',
        'NEUMAR_APP_DATA_DIR must be an absolute temp path',
        'sanitization.appDataDir',
      ),
    );
  } else if (isInsideHome(sanitization.appDataDir)) {
    violations.push(
      violation(
        'sanitization-home',
        'NEUMAR_APP_DATA_DIR must not be inside the host home directory',
        'sanitization.appDataDir',
      ),
    );
  }
  if (sanitization.hostHomeUntouched !== true) {
    violations.push(
      violation(
        'sanitization-home-untouched',
        'the worker must not touch the host home directory',
        'sanitization.hostHomeUntouched',
      ),
    );
  }
  if (!['none', 'stubbed'].includes(sanitization.thirdPartyCalls)) {
    violations.push(
      violation(
        'sanitization-third-party',
        'third-party calls must be none or stubbed',
        'sanitization.thirdPartyCalls',
      ),
    );
  }
  if (sanitization.credentialsPresent !== false) {
    violations.push(
      violation(
        'sanitization-credentials',
        'the worker environment must contain no publish credentials',
        'sanitization.credentialsPresent',
      ),
    );
  }
}

function validateCorrective(corrective, violations) {
  if (corrective === 'not applicable') return;
  if (!corrective || typeof corrective !== 'object') {
    violations.push(
      violation(
        'pr-corrective',
        'corrective fields or "not applicable" are required',
        'prTemplate.corrective',
      ),
    );
    return;
  }
  for (const field of [
    'originalFindingLink',
    'introducingPr',
    'failingScenario',
    'reviewGap',
    'preventionTest',
  ]) {
    if (!isNonEmptyString(corrective[field])) {
      violations.push(
        violation(
          'pr-corrective',
          `${field} is required for a corrective change`,
          `prTemplate.corrective.${field}`,
        ),
      );
    }
  }
}

function validatePrTemplate(prTemplate, expected, violations) {
  if (!prTemplate || typeof prTemplate !== 'object') {
    violations.push(
      violation('field-shape', 'PR template fields are required', 'prTemplate'),
    );
    return;
  }
  if (!isNonEmptyString(prTemplate.title)) {
    violations.push(
      violation('pr-title', 'a title is required', 'prTemplate.title'),
    );
  } else if (prTemplate.title.length > 70) {
    violations.push(
      violation(
        'pr-title-too-long',
        'PR titles are at most 70 characters',
        'prTemplate.title',
      ),
    );
  }
  if (prTemplate.exactHeadSha !== expected.headSha) {
    violations.push(
      violation(
        'pr-head-mismatch',
        'the PR must name the exact checked head SHA',
        'prTemplate.exactHeadSha',
      ),
    );
  }
  if (!isNonEmptyString(prTemplate.nodeVersion)) {
    violations.push(
      violation(
        'pr-node-version',
        'record the Node version used for validation',
        'prTemplate.nodeVersion',
      ),
    );
  }
  if (!isNonEmptyString(prTemplate.pnpmVersion)) {
    violations.push(
      violation(
        'pr-pnpm-version',
        'record the pnpm version used for validation',
        'prTemplate.pnpmVersion',
      ),
    );
  }
  if (!isNonEmptyString(prTemplate.intent)) {
    violations.push(
      violation('pr-intent', 'intent is required', 'prTemplate.intent'),
    );
  }
  if (!isNonEmptyString(prTemplate.affectedContracts)) {
    violations.push(
      violation(
        'pr-contracts',
        'affected contracts and consumers are required',
        'prTemplate.affectedContracts',
      ),
    );
  }
  if (!isNonEmptyString(prTemplate.verificationSummary)) {
    violations.push(
      violation(
        'pr-verification',
        'a verification summary is required',
        'prTemplate.verificationSummary',
      ),
    );
  }
  const attribution = prTemplate.attribution;
  if (!attribution || typeof attribution !== 'object') {
    violations.push(
      violation(
        'pr-attribution',
        'attribution fields are required',
        'prTemplate.attribution',
      ),
    );
  } else {
    for (const field of [
      'accountableContributor',
      'authoringTool',
      'sessionReference',
    ]) {
      if (!isNonEmptyString(attribution[field])) {
        violations.push(
          violation(
            'pr-attribution',
            `${field} is required`,
            `prTemplate.attribution.${field}`,
          ),
        );
      }
    }
  }
  if (prTemplate.closesIssue !== expected.issue) {
    violations.push(
      violation(
        'pr-closes-issue',
        'the PR must close the bug issue, not the epic',
        'prTemplate.closesIssue',
      ),
    );
  }
  checkStringArray(prTemplate.unverified, 'prTemplate.unverified', violations, {
    allowEmpty: true,
  });
  validateCorrective(prTemplate.corrective, violations);
}

/**
 * Validate a worker report against the exact base/head/branch/issue the
 * publisher is about to use.
 */
export function validateVerificationReport(report, expected = {}) {
  const violations = [];
  if (!report || typeof report !== 'object') {
    return {
      ok: false,
      violations: [violation('report-shape', 'a report object is required')],
    };
  }
  if (report.version !== REPORT_VERSION) {
    violations.push(
      violation(
        'report-version',
        `report version must be ${REPORT_VERSION}`,
        'version',
      ),
    );
  }
  if (report.issue !== expected.issue) {
    violations.push(
      violation('report-issue', 'report is for a different issue', 'issue'),
    );
  }
  if (
    !report.claim ||
    report.claim.runId !== expected.claim?.runId ||
    report.claim.epoch !== expected.claim?.epoch
  ) {
    violations.push(
      violation(
        'report-claim',
        'report claim does not match the publisher claim',
        'claim',
      ),
    );
  }
  if (report.branch !== expected.branch) {
    violations.push(
      violation('report-branch', 'report is for a different branch', 'branch'),
    );
  }
  if (!isGitSha(report.baseSha) || report.baseSha !== expected.baseSha) {
    violations.push(
      violation(
        'report-base',
        'report base SHA does not match the pinned base',
        'baseSha',
      ),
    );
  }
  if (!isGitSha(report.headSha) || report.headSha !== expected.headSha) {
    violations.push(
      violation(
        'report-head',
        'report head SHA does not match the proposed head',
        'headSha',
      ),
    );
  }
  if (report.reproduced !== true) {
    violations.push(
      violation(
        'report-not-reproduced',
        'the reported bug was not reproduced',
        'reproduced',
      ),
    );
  }

  validateSanitization(report.sanitization, violations);
  validateRegression(report.regression, expected, violations);

  const reportedFiles = checkStringArray(
    report.changedFiles,
    'changedFiles',
    violations,
  );
  const expectedFiles = expected.changedFiles ?? [];
  const reportedSet = new Set(
    reportedFiles
      .map((file) => normalizeRepoPath(file))
      .filter((result) => result.ok)
      .map((result) => result.path),
  );
  const expectedSet = new Set(
    expectedFiles
      .map((file) => normalizeRepoPath(file))
      .filter((result) => result.ok)
      .map((result) => result.path),
  );
  for (const file of expectedSet) {
    if (!reportedSet.has(file)) {
      violations.push(
        violation(
          'report-changed-files',
          `${file} is missing from the report`,
          'changedFiles',
        ),
      );
    }
  }
  for (const file of reportedSet) {
    if (!expectedSet.has(file)) {
      violations.push(
        violation(
          'report-changed-files',
          `${file} is not in the actual patch`,
          'changedFiles',
        ),
      );
    }
  }

  const checks = Array.isArray(report.checks) ? report.checks : [];
  if (!Array.isArray(report.checks)) {
    violations.push(
      violation('field-shape', 'checks must be an array', 'checks'),
    );
  }
  const byName = new Map();
  for (const check of checks) {
    if (!check || !isNonEmptyString(check.name)) {
      violations.push(
        violation('check-shape', 'each check needs a name', 'checks'),
      );
      continue;
    }
    if (!['passed', 'failed', 'skipped'].includes(check.status)) {
      violations.push(
        violation(
          'check-status',
          `${check.name} has an unknown status`,
          'checks',
        ),
      );
    }
    if (check.status === 'skipped' && !isNonEmptyString(check.reason)) {
      violations.push(
        violation(
          'check-skipped-reason',
          `${check.name} must record why it was skipped`,
          'checks',
        ),
      );
    }
    if (byName.has(check.name)) {
      violations.push(
        violation(
          'check-duplicate',
          `${check.name} is reported more than once`,
          'checks',
        ),
      );
      continue;
    }
    byName.set(check.name, check);
  }
  for (const name of requiredChecksForFiles([...expectedSet])) {
    const check = byName.get(name);
    if (!check) {
      violations.push(
        violation('check-missing', `${name} was not run or reported`, 'checks'),
      );
    } else if (check.status !== 'passed') {
      violations.push(
        violation('check-not-passed', `${name} is ${check.status}`, 'checks'),
      );
    } else if (check.command !== name) {
      violations.push(
        violation(
          'check-command-mismatch',
          `${name} must record the exact command it ran`,
          'checks',
        ),
      );
    }
  }

  validatePrTemplate(report.prTemplate, expected, violations);

  return { ok: violations.length === 0, violations };
}

/** Build the canonical worker report so tests and callers share one shape. */
export function createVerificationReport({
  issue,
  claim,
  branch,
  baseSha,
  headSha,
  reproduced,
  aborted = false,
  abortReason = null,
  sanitization,
  regression,
  checks = [],
  changedFiles = [],
  prTemplate,
  unverified = [],
}) {
  return {
    version: REPORT_VERSION,
    issue,
    claim: { issue, runId: claim?.runId, epoch: claim?.epoch },
    branch,
    baseSha,
    headSha,
    reproduced: reproduced === true,
    aborted: aborted === true,
    abortReason,
    sanitization,
    regression,
    checks,
    changedFiles,
    prTemplate,
    unverified,
  };
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Render `.github/PULL_REQUEST_TEMPLATE.md` from validated report fields. */
export function buildPullRequestBody(report) {
  const template = report.prTemplate;
  const rows = report.checks.map(
    (check) =>
      `| \`${escapeCell(check.command ?? check.name)}\` | ${escapeCell(
        check.status,
      )}${check.evidence ? `: ${escapeCell(check.evidence)}` : ''} |`,
  );
  const corrective =
    template.corrective === 'not applicable'
      ? ['Not applicable.']
      : [
          `Original finding link: ${template.corrective.originalFindingLink}`,
          `Introducing PR or commit: ${template.corrective.introducingPr}`,
          `Reproducible failing scenario: ${template.corrective.failingScenario}`,
          `Review/check gap: ${template.corrective.reviewGap}`,
          `Prevention test or check: ${template.corrective.preventionTest}`,
        ];
  const unverified =
    template.unverified.length === 0
      ? 'None recorded.'
      : template.unverified.map((entry) => `- ${entry}`).join('\n');

  return [
    '## Intent and scope',
    '',
    `Intent and resulting behavior: ${template.intent}`,
    '',
    `Affected contracts and consumers: ${template.affectedContracts}`,
    '',
    '## Verification evidence',
    '',
    `Exact checked commit SHA: \`${template.exactHeadSha}\``,
    '',
    `Node and pnpm versions: ${template.nodeVersion} / ${template.pnpmVersion}`,
    '',
    '| Command or check | Outcome and evidence |',
    '| --- | --- |',
    ...rows,
    '',
    `Regression evidence: ${template.verificationSummary}`,
    '',
    'Unverified cases and skipped checks, with reasons:',
    '',
    unverified,
    '',
    '## Attribution',
    '',
    `Accountable contributor: ${template.attribution.accountableContributor}`,
    '',
    `Authoring tool/configuration, if known: ${template.attribution.authoringTool}`,
    '',
    `Session reference, if known: ${template.attribution.sessionReference}`,
    '',
    '## Corrective change',
    '',
    ...corrective,
    '',
    '## Related issue',
    '',
    `Closes #${template.closesIssue}`,
    '',
  ].join('\n');
}
