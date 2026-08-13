# Publish Workflows

Publish workflows are versioned conventions layered on the existing publish
ledger, scheduler, and orchestrator. They are not a separate queue runtime.

Each workflow version exports a small runner contract from
`vX.Y.Z/post.workflow.ts`. New behavior should land as a new version and the
ledger stamps new jobs with that version. Historical jobs keep their original
`workflow_version` and `workflow_state_json` so they remain inspectable after
workflow changes.

The current default is `1.0.0`.
