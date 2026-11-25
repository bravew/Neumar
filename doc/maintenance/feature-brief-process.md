# Reviewed Feature Brief process

A feature request is not permission to build. This page defines the document a
maintainer must approve, and the deterministic gate that stops a feature worker
from starting without that approval. It belongs to epic #359 and issue #364. The
worker, publisher, and reviewer that consume the gate are #362, #363, and #365.

## Two documents, two jobs

| Document | Written by | Purpose |
| --- | --- | --- |
| Feature request issue, from `.github/ISSUE_TEMPLATE/feature_request.yml` | Anyone | Records a problem, a proposal, and alternatives. Never starts work. |
| Reviewed Feature Brief | A maintainer, usually from the request | The specification a worker implements. Approval is bound to its exact content. |

The issue template stays lightweight on purpose. The `enhancement` label is also
used for epics, so the label alone says nothing about approval.

## The brief

A brief is Markdown. It can live in the issue body or in a file on the epic
branch. The header carries the target epic branch. Seven `##` sections are
required. A section that is missing, empty, or only a placeholder such as `TBD`
fails validation.

| Section | Must contain |
| --- | --- |
| User outcome | What a user can do afterwards. |
| Non-goals | What is explicitly out of scope. |
| Accountable owner | One human collaborator, as a GitHub login. |
| Acceptance criteria | A bullet list. Each bullet starts with a surface tag: `[http-route]`, `[mcp-handler]`, `[tauri-ipc]`, or `[ui-flow]`. A criterion with no caller-level surface is rejected. |
| Platform, branding and i18n | A `User-facing text: yes` or `no` line. `yes` requires all six locales (`en`, `zh`, `es`, `fr`, `hi`, `pt`) to be named. |
| Security and boundaries | Which of `safeFetch`, `path-validator.ts`, `getAppDir()`, and Tauri capabilities the feature touches, or that it touches none. |
| Slices | Ordered `### S1: title` blocks, each with `Owned files`, `Shared files`, and `Depends on`. |

Slice rules, taken from `LESSONS.md`, "Working with parallel agents":

- `Shared files` is mandatory, with `none` when empty. A slice that lists
  `package.json`, `pnpm-lock.yaml`, locale modules, the component size allowlist,
  `http-daemon.ts`, `video-edit-server.ts`, or `packages/video-ir/` under
  `Owned files` fails. Those edits must be scheduled as shared.
- `Depends on` is mandatory, with `none` when it depends on nothing. `Depends on`
  may only name an earlier slice.
- Paths are repository-relative. A noncanonical spelling such as `./package.json`
  is normalized before the shared-file check, so it cannot dodge that rule.
- A section that contains only a placeholder, including a placeholder bullet
  such as `- TBD`, counts as empty.

A valid example is
[fixtures/valid-brief.md](../../scripts/feature-brief/fixtures/valid-brief.md).

## Approval

Approval is a comment on the feature issue from a repository `OWNER`, `MEMBER`,
or `COLLABORATOR`. It carries the SHA-256 digest of the canonical brief, the
epic branch, and the slices it authorizes.

```text
Brief-Approval: sha256=<64 hex> epic=epic/<N>-<slug> slices=S1,S2
Brief-Approval-Withdrawn: sha256=<64 hex>
```

Get the digest with
`node scripts/feature-brief/cli.mjs digest <brief.md>`. The canonical form
normalizes line endings and trailing whitespace only. Any other edit changes the
digest, so an edited brief has no approval until a maintainer approves the new
revision.

The gate ignores or rejects:

- Labels. Editing an issue does not clear a label, so a label can outlive the
  scope it approved.
- The issue author's own approval. A requester cannot approve their own request,
  matching GitHub's rule for pull request authors.
- Comments from any other author association.
- Comments whose author type is not `User`.
- Comments edited after they were posted. A collaborator can edit another
  person's comment, so an edited comment cannot be trusted as written.
- Marker lines inside code fences or block quotes. Fences follow CommonMark:
  `~~~` counts, and a shorter or differently fenced line does not close an open
  fence.

The latest trusted decision for the current digest wins. A later withdrawal
blocks, and a later approval restores. Decisions in the same second are ordered
by numeric comment id, so a withdrawal posted after an approval still wins.
Approval for a different digest never applies.

This binds approval to a digest of the brief content rather than a commit SHA,
so the same rule works whether the brief sits in an issue body or on a branch.
A model acting through the maintainer's own token cannot be told apart from the
maintainer. Keep the publisher App and the maintainer identity separate (#362).

## The gate

`evaluateFeatureClaim` in `scripts/feature-brief/approval.mjs` is a pure
function. The caller reads the issue, labels, comments, and brief, then passes
them in with `readComplete: true`. The input must include the issue author's
`authorLogin` and each comment's `authorLogin`. A missing author is an incomplete
read, because the gate cannot tell an approval from the requester's
self-approval without it.

| State | Meaning | Claim |
| --- | --- | --- |
| `unknown` | A GitHub read was partial or failed, or an author identity is missing. | None. Never treated as empty. |
| `blocked` | Closed, `agent:hold`, `needs-decision`, no approval, withdrawn, stale digest, wrong epic, or slice not authorized. | None. |
| `needs-decision` | The brief is missing or underspecified. | None. Returns `labelsToAdd: ['needs-decision']` and exactly one `question`. |
| `eligible` | Trusted approval matches the current digest. | Only the authorized slices. |

When a request is underspecified, the gate asks one concrete question taken from
the first gap and does not guess (`AGENTS.md`, working agreement 3). Posting the
label and the question is the caller's job, and it should post the question once
per digest.

### Revalidation

`claimFromEvaluation` records `{ digest, epicBranch, slice }`. Call
`revalidateClaim` at worker start and again just before the publisher pushes. It
re-reads current state, so a brief edit, a withdrawal, a new hold, or a failed
read between claim and push invalidates the claim. #362 and #365 must call it at
both points.

## Commands

```bash
node scripts/feature-brief/cli.mjs validate <brief.md>
node scripts/feature-brief/cli.mjs digest <brief.md>
node scripts/feature-brief/cli.mjs evaluate <input.json>
node --test scripts/feature-brief/
```

`evaluate` exits 0 only when the slice is eligible.

## Not covered here

- Live polling, claim leases, and the stop switch belong to #361.
- The publisher path deny-list (`.github/**`, Tauri capability and signing files,
  release scripts, policy documents, ceiling raises) belongs to #362. A brief
  cannot authorize those paths.
- Slice execution and integrated-head verification belong to #365.
