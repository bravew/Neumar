# Connectors

`live-dashboard` is a **Live Artifact**. The values it shows are not
hard-coded — they are polled from a connector at runtime. The DesignMode daemon
(0.4.0+) ships a external connector catalog and a `connectors.json`
contract that artifacts emit alongside `index.html`.

When `inputs.connector === mock` (or the daemon cannot resolve the
configured connector), the artifact falls back to seeded sample data.
This keeps screenshots, the picker preview, and offline use working.

> **Status — relationship to `skills/live-artifact/`.**
>
> The canonical, currently-shipping live-artifact contract lives in
> [`skills/live-artifact/SKILL.md`](../../live-artifact/SKILL.md): it is
> *file-shaped* (`artifact.json` + `template.html` + `data.json` +
> `provenance.json`) and *CLI-shaped* on the agent side (the agent calls
> `"$NEUMA_NODE_BIN" "$NEUMA_BIN" tools live-artifacts {create,update}` and
> `tools connectors {list,execute}` rather than HTTP). The renderer is
> scalar-only `html_template_v1` (`apps/daemon/src/live-artifacts/render.ts`).
>
> `live-dashboard` is a **complementary** browser-runtime variant: the
> artifact is rendered as a single self-contained HTML page, and the
> live behaviors (refresh-on-open, manual Refresh, auto-refresh, stale
> pill) run in-page rather than at template-render time. Polling
> therefore needs an HTTP shape, which is what the rest of this file
> describes (`POST /api/od/connectors/poll`).
>
> Treat the HTTP shape below as a **forward-looking proposal** that
> sits alongside the file/CLI contract: the daemon does not yet expose
> `POST /api/od/connectors/poll` (`apps/daemon/src/server.ts` /
> `apps/daemon/src/live-artifacts/`), so out-of-the-box the artifact
> renders against the seeded sample data and the Refresh button only
> tweens the fixture. When the daemon-team route lands, only
> `seedNextChange()` in the template needs to be replaced with the
> `poll()` helper documented here — the `connectors.json` shape is
> already a usable declarative source-of-truth that downstream tooling
> (the live-artifact CLI, MCP wrappers, audit logs) can read today.

---

## `connectors.json` schema

Emit one `connectors.json` at the project root next to `index.html`:

```json
{
  "schema": "od.connector/1",
  "primary": "notion",
  "freshness": {
    "auto_refresh_seconds": 30,
    "warn_after_seconds": 90,
    "fail_after_seconds": 600
  },
  "bindings": {
    "notion": {
      "connectorId": "notion",
      "reads": [
        {
          "id": "tasks_active",
          "toolName": "notion.search_pages",
          "input": { "query": "${notion.topic}" },
          "shape": "task[]"
        }
      ]
    }
  }
}
```

Connector ids and tool names come from the daemon catalog. List them
with `tools connectors list --format compact`; do not infer Composio
tool names or call provider APIs directly from artifact code.

---

## Resolution order (what the daemon does)

1. Read `connectors.json` from the artifact dir.
2. Look up `bindings[primary].connectorId` in the connector catalog.
3. Verify each `reads[].toolName` is still connected, allowed, read-only,
   auto-approved, and refresh-eligible.
4. Execute through the daemon wrapper with the injected `NEUMA_TOOL_TOKEN`.
5. Cache responses for `freshness.auto_refresh_seconds`. The
   `Refresh` button issues an explicit poll that bypasses the cache.

---

## Wiring inside `index.html`

The artifact does **not** call external directly. It calls the OD
daemon's local proxy:

```js
async function poll(readId) {
  const res = await fetch(`/api/od/connectors/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: "<project_id>", read: readId })
  });
  if (!res.ok) throw new Error(`poll ${readId} failed: ${res.status}`);
  return res.json();
}
```

`<project_id>` is injected by the daemon at render time via a
`<meta name="od:project" content="...">` tag. The artifact reads it
once on mount.

---

## Fallback behavior

- On `fetch` error: keep the previously-rendered values, swap the
  live-pill to amber `Stale · <ago>`, write a small grey hint into the
  footer (`Source: Notion · last good poll 4 min ago`).
- On `inputs.connector === mock`: skip `poll()` entirely, use the
  `seedMock()` function in `index.html`. The live-pill displays
  `Sample data` in grey with no dot animation.
- On 401/403: surface a one-time toast `Reconnect Notion in Settings →
  Connectors` and stop further polls until the next manual Refresh.

---

## Provider-specific cheat sheet

| Connector | Example tool                         | Shape of one row             | Typical KPI                        |
|---        |---                                   |---                           |---                                 |
| Notion    | `notion.search_pages`                | `task = {title, status, assignee, due, prio, updated}` | total tasks · done this week · members · review |
| Linear    | `linear.linear_get_issue`            | `issue = {title, state, assignee, priority, updated}`  | backlog · in progress · blocked · cycle progress |
| Stripe    | `stripe.stripe_list_customers`       | `customer = {name, email, created}`                    | MRR · churn · new subs · refunds   |
| GitHub    | `github.github_search_repositories`  | `repo = {name, owner, stars, updated}`                 | repos · issues · PRs · velocity    |

Do not invent per-provider shapes. If the user wants something not in
this table, fall back to `mock` and surface a footer hint asking the
user to extend the connector catalog.
