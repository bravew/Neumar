# Policy replay against the documented historical cases

Date: 2026-10-14. This note applies the contributor quality policy in
[03-lessons-and-contributors.md](../2026-10-13-regression/03-lessons-and-contributors.md)
to the cases that review recorded, and shows each one landing on the intended
side of the thresholds. It is a paper replay of the policy, not a new
investigation. It adds no names and confirms no new incident.

## The thresholds under test

- **Probation:** two confirmed escaped material defects attributable to the same
  contributor or tool configuration within 90 days.
- **Block from autonomous submission or merge:** three confirmed material
  incidents within 90 days, including at least one repeated failure class after
  its documented correction, or a verified deliberate bypass of required
  validation.
- **Reinstatement:** repair outstanding incidents, demonstrate the failed
  contracts under the new gate, and pass three independently reviewed scoped
  contributions. Review a block after 30 days; renew only with stated evidence.
  An appeal can correct attribution, severity, or causation at any time.

A record counts only after two reviewers, or a maintainer with an independent
verification artifact, confirm it. The blocklist stays empty until that evidence
bar and a maintainer decision both exist.

## Counting rules the replay applies

1. **One incident, once.** A defect introduced by an epic and carried by its
   sub-PRs is a single incident, counted at the introducing change. Do not count
   it again at each sub-PR.
2. **A repair is not a strike.** A corrective PR that fixes a preexisting defect
   does not receive its own incident. The defect counts where it was introduced.
3. **A transient infrastructure failure is not a code-quality incident.**
   Environment-specific or flaky failures do not count against a contributor.
4. **Attribution must be proven.** A reference to a tool or vendor in code, a
   title, or a session trailer is not authorship evidence. Use `unknown` and do
   not count when the evidence does not exist.
5. **A current check rollup does not establish what was known at merge.** Only a
   check that completed before merge, on the matching head, is merge-time
   evidence.

## Case replay

| Case | Candidate incident | Decision | Policy landing |
| --- | --- | --- | --- |
| Stacked PRs #102, #103, #105 | The duplicate `toolResultText` import in #103 squash `10edc9f3`, after #102 introduced the symbol, plus the API test type and format errors #105 repaired. | One incident. It is one failure chain across a stacked branch, counted once at the integration defect, not three times. #102 is mostly a legitimate lockfile pin; #103 is smaller than its stacked totals suggest; #105 is the corrective author and gets no strike. | 1 confirmed incident, below probation (2) and block (3). |
| Manual CI #176 | The mock and toast drift that #175 introduced and #176 repaired, which automatic PR CI did not catch because the quality and Test jobs run only on release heads. | One incident, counted at #175, the introducing change. #176 is the repair and is not counted. The missing automatic PR gate is the check gap, recorded as a process fix, not a second strike. | 1 confirmed incident for the introducing configuration, below probation and block. The gate gap is a process item, not a contributor incident. |
| Different authors | Two or more contributors are said to have authored the held PRs, so the same defect pattern might accumulate per contributor. | No count. All sampled merged PRs share one GitHub identity and tool or session attribution is incomplete, so the policy cannot fairly attribute repeated defects to a named human, vendor, model family, or agent session. Even with attribution, each documented case above is a single incident. | 0 counted, below probation and block. |
| Infrastructure failure: `resolve.test.ts:251` | The `pnpm test:fast` failure on a host with Homebrew OpenCode installed, tracked in #195. | No count. It is an environment-specific test-isolation defect, not a contributor's code-quality incident. | 0 counted. Handled as test-isolation work, not a strike. |
| Timing case: #104 audit | An audit check that completed after #104 merged. | No count. A current rollup alone cannot establish what was known at merge, and this failure completed after merge, so it is not an already-red merge. | 0 counted. |

Every documented case lands below the probation threshold of two, so the replay
produces no probation and no block. The intended side of each threshold is the
side with fewer than two confirmed, attributable incidents.

## Per-configuration check

The policy counts per contributor or tool configuration within 90 days, not per
repository.

| Configuration | Confirmed incidents in the replay | Threshold reached |
| --- | ---: | --- |
| Introducing configuration for the stacked-PR chain | 1 | None; below probation. |
| Introducing configuration for the #175 to #176 chain | 1 | None; below probation. |
| Every other sampled configuration | 0 | None. |

No configuration reaches two incidents, so no probation entry is created. With no
probation entries, no configuration can reach the third incident that would
trigger a block, including the repeated-failure-class condition. The blocklist
stays empty.

## Reinstatement path, if an entry existed

For a hypothetical block created from this policy, clearing it follows the same
reinstatement path the policy states, and the entry's own fields carry the
details:

1. Repair the outstanding incidents named in the entry's `incidentRecords`.
2. Demonstrate the failed contracts under the current gate, using the boundary
   the incident record names.
3. Pass three independently reviewed scoped contributions.
4. At the entry's `expiry`, review the block and renew it only with stated
   evidence, or let it lapse.
5. At any time, an appeal filed at `appealLink` can correct attribution,
   severity, or causation, which can remove the entry.

## What this replay does not establish

- It does not confirm any new incident. It reuses the review's recorded findings
  and its attribution limits.
- It does not identify an author. Attribution stays `unknown` where the review
  could not prove it.
- It does not evaluate the thresholds against code that changed after the
  reviewed baseline `c0926618`. Re-run it when a new confirmed record exists.
- It does not create, extend, or lift a restriction. The blocklist is empty and
  no repository setting has changed.
