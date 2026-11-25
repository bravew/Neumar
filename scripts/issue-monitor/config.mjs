// Defaults for the read-only issue monitor. Every value here is a policy knob
// the runbook (doc/maintenance/cloud-issue-monitor.md) names; none of them
// grants write access to anything.

export const DEFAULT_CONFIG = Object.freeze({
  labels: Object.freeze({
    approved: 'agent:bug-approved',
    hold: 'agent:hold',
    needsDecision: 'needs-decision',
    bug: 'bug',
    security: 'security',
    features: Object.freeze(['enhancement', 'epic']),
  }),
  // Associations whose label changes count as maintainer decisions.
  trustedAssociations: Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']),
  leaseTtlMs: 30 * 60 * 1000,
  // The cron reconciliation re-reads this much before the watermark so clock
  // skew and eventual consistency cannot hide an update.
  overlapMs: 15 * 60 * 1000,
  maxClaimsPerDay: 3,
  maxAttemptsPerIssue: 2,
  // Webhook delivery ids remembered for duplicate suppression.
  deliveryMemory: 200,
});

const POSITIVE_INTEGER_KEYS = [
  'leaseTtlMs',
  'overlapMs',
  'maxClaimsPerDay',
  'maxAttemptsPerIssue',
  'deliveryMemory',
];

export function resolveConfig(overrides = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...overrides,
    labels: { ...DEFAULT_CONFIG.labels, ...overrides.labels },
  };
  for (const key of POSITIVE_INTEGER_KEYS) {
    if (!Number.isInteger(config[key]) || config[key] <= 0) {
      throw new RangeError(
        `issue-monitor config ${key} must be a positive integer`,
      );
    }
  }
  return Object.freeze(config);
}
