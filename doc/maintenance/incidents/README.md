# Contributor policy records

Date: 2026-10-14. This directory holds the records that the contributor quality
policy in
[03-lessons-and-contributors.md](../2026-10-13-regression/03-lessons-and-contributors.md)
asks for: the incident record template, the empty blocklist, and the replay of
the thresholds against the documented historical cases.

The policy starts without names. No contributor, vendor, model family, or agent
session is identified here, and the blocklist is empty.

| File | Purpose |
| --- | --- |
| [incident-record-template.md](incident-record-template.md) | Blameless incident record format |
| [blocklist.json](blocklist.json) | Empty blocklist with the entry schema |
| [blocklist-schema.mjs](blocklist-schema.mjs) | Schema constants and validation, shared by the check and its tests |
| [fixtures/blocklist-valid.json](fixtures/blocklist-valid.json) | A valid entry used only to exercise the schema |
| [fixtures/blocklist-invalid.json](fixtures/blocklist-invalid.json) | An entry missing a required field, used only to exercise rejection |
| [policy-replay.md](policy-replay.md) | Each documented historical case placed against the thresholds |

## Rules this directory follows

- An incident record names the contract that failed and the gate that missed it.
  It does not judge a person. The practice is blameless postmortem
  ([Google SRE](https://sre.google/sre-book/postmortem-culture/)).
- A record counts only after two reviewers or a maintainer with an independent
  verification artifact confirm it.
- The blocklist stays empty until the policy's own evidence bar is met and a
  maintainer records a decision. Each entry must carry evidence, affected scope,
  effective date, expiry, remediation, and an appeal link.
- A block applies to a demonstrated contributor or tool configuration. It is not
  a blacklist of a vendor or a model family.

## Checks

```bash
node doc/maintenance/incidents/check-blocklist.mjs doc/maintenance/incidents/blocklist.json
node --test doc/maintenance/incidents/check-blocklist.test.mjs
```

The first command validates the committed blocklist. The test runs the same
validator against both fixtures and asserts the valid entry is accepted and the
entry missing a required field is rejected.
