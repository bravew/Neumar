// Pure eligibility decision for one issue.
//
// Issue titles, bodies, and comments are untrusted data and never reach this
// function: the normalized issue shape carries only labels, state, and the
// label-event history. Approval is the latest `labeled` event for the approval
// label, applied by an actor the collaborator lookup resolved as trusted.
// Comment text such as "approved" has no path into a decision.

import { DEFAULT_CONFIG } from './config.mjs';

/**
 * @returns {{status: 'absent'|'unverifiable'|'untrusted'|'approved', actor?: string, association?: string, at?: string}}
 */
export function resolveApproval(issue, trusted, config = DEFAULT_CONFIG) {
  const label = config.labels.approved;
  if (!issue.labels.includes(label)) return { status: 'absent' };

  // The label is present, so a missing or inconsistent history is "unknown",
  // never "approved".
  if (!Array.isArray(issue.labelEvents)) return { status: 'unverifiable' };
  const latest = issue.labelEvents
    .filter((event) => event.label === label)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .at(-1);
  if (!latest || latest.event !== 'labeled' || !latest.actor) {
    return { status: 'unverifiable' };
  }

  const association = trusted.get(latest.actor.toLowerCase()) ?? 'NONE';
  return {
    status: config.trustedAssociations.includes(association)
      ? 'approved'
      : 'untrusted',
    actor: latest.actor,
    association,
    at: latest.createdAt,
  };
}

/**
 * @param {Map<string, string>} trusted lower-cased login to association
 * @returns {{eligible: boolean, reason: string, approval?: ReturnType<typeof resolveApproval>}}
 */
export function decideIssue(issue, trusted, config = DEFAULT_CONFIG) {
  const L = config.labels;
  const has = (name) => issue.labels.includes(name);
  const skip = (reason, approval) => ({ eligible: false, reason, approval });

  if (issue.isPullRequest) return skip('pull-request');
  if (issue.state !== 'open') return skip('closed');
  if (has(L.hold)) return skip('held');
  if (has(L.needsDecision)) return skip('needs-decision');
  if (has(L.security)) return skip('security-sensitive');
  if (L.features.some(has)) return skip('feature-request');
  if (!has(L.bug)) return skip('not-a-bug');

  const approval = resolveApproval(issue, trusted, config);
  if (approval.status === 'absent') return skip('not-approved', approval);
  if (approval.status === 'untrusted') {
    return skip('approval-untrusted', approval);
  }
  if (approval.status === 'unverifiable') {
    return skip('approval-unverifiable', approval);
  }
  if (issue.linkedOpenPrs > 0) return skip('linked-pr-exists', approval);

  return { eligible: true, reason: 'eligible', approval };
}
