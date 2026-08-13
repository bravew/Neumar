# Linear Pipeline

The Linear Pipeline is a fully autonomous **ticket-to-pull-request** workflow. When a Linear issue is ready for development, the pipeline automatically: writes the code, verifies it, reviews it, opens a PR, handles review feedback, notifies Slack, and updates the Linear issue — all without human intervention until the PR review stage.

---

## Pipeline Overview

```
Linear Issue (webhook or polling)
        │
        ▼
1.  Triage          Classify issue (bug/feature/chore/refactor)
        │
        ▼
2.  Preflight       Clean workspace, verify dependencies
        │
        ▼
3.  Branch          git checkout -b <branch-name>
        │
        ▼
4.  Agent Execute   Plan → approval → execute (up to 10min/phase)
        │
        ▼
5.  Verify          Run lint + tsc (up to 3 retries)
        │
        ▼
6.  Self-Review     Analyze git diff for issues
        │
        ▼
7.  Create PR       gh pr create with summary
        │
        ▼
8.  PR Review Loop  Poll GitHub (every 5min, 24h window, max 10 fix rounds)
        │
        ▼
9.  Slack Notify    Post result to configured channel
        │
        ▼
10. Update Linear   Set issue status + add comment with PR link
```

---

## Sequential Queue

The pipeline processes **one ticket at a time**. A concurrent second ticket would cause workspace conflicts (shared git state, node_modules, etc.). The queue is persisted to `~/.<slug>/pipeline-state.json` so it survives application restarts.

When a ticket enters the queue:
- If the queue is empty → start immediately
- If a ticket is running → enqueue and wait

---

## Issue Sources

### Webhook (real-time)

Linear sends webhooks to:
```
POST /linear/webhook
```

Security verification:
1. **IP allowlist** — Only Linear's published IP ranges
2. **HMAC-SHA256** — `X-Linear-Signature` header verified with webhook secret
3. **Idempotency** — `Linear-Delivery` header deduplicated (TTL-based)

### Polling (fallback)

If a webhook URL is not configured, the pipeline polls the Linear API every N minutes for issues matching the configured label/state filters.

---

## Triage Logic

The triage step classifies the issue to set the correct agent behavior:

**By Labels** (checked first):
- `bug` label → bug fix mode
- `feature` label → new feature mode
- `chore` label → maintenance mode
- `refactor` label → refactoring mode

**By Title Patterns** (fallback):
- "fix:", "bug:" → bug
- "feat:", "add:", "implement:" → feature
- "chore:", "update:", "upgrade:" → chore
- "refactor:", "clean:" → refactor

---

## Configuration

Configuration is stored as **AES-256-GCM encrypted JSON** in `~/.<slug>/linear.enc.json`:

| Field | Description |
|---|---|
| `apiKey` | Linear API key |
| `webhookSecret` | Webhook HMAC secret |
| `teamId` | Linear team ID to watch |
| `labelFilter` | Only process issues with this label |
| `githubToken` | GitHub token for PR creation |
| `slackWebhookUrl` | Slack webhook for notifications |
| `workspaceDir` | Target repository path |

Configure in **Settings → Linear Pipeline**.

---

## Agent Prompts

The pipeline constructs agent prompts with XML delimiters to defend against prompt injection:

```xml
<system-instruction>
You are working on a software ticket. Implement the following change...
</system-instruction>

<user-input>
{sanitized ticket title and description — max 10,000 chars}
</user-input>
```

Ticket content is HTML-stripped and truncated to 10,000 characters before inclusion.

---

## Verification Step

After the agent executes, the pipeline runs:

```bash
pnpm lint && pnpm tsc --noEmit
```

If verification fails, the agent is re-invoked with the error output (up to **3 retries**). On the third failure, the ticket is marked as failed and Slack is notified.

---

## PR Review Loop

After opening the PR, the pipeline polls GitHub every **5 minutes** for:

- **Approved** → pipeline complete
- **Changes requested** → re-invoke agent with reviewer comments (up to **10 rounds**)
- **Timeout after 24 hours** → pipeline complete (manual follow-up needed)

---

## Slack Notifications

The pipeline posts to Slack at completion:

**Success:**
```
✅ PR opened for LINEAR-123: Add user authentication
https://github.com/org/repo/pull/456
```

**Failure:**
```
❌ Pipeline failed for LINEAR-123: verification failed after 3 retries
```

---

## Security Considerations

| Concern | Mitigation |
|---|---|
| Prompt injection via ticket | XML delimiters, 10K char limit, HTML stripping |
| Unreviewed merges | Auto-merge disabled; PR review required |
| Scoped git operations | Targeted staging (filters `.env`, `.key`, `.pem`) |
| Verification bypass | Lint + tsc required; cannot skip |
| Workspace conflicts | Sequential queue |
| Credential storage | AES-256-GCM encryption at rest |
| Webhook spoofing | HMAC-SHA256 + IP allowlist + idempotency |

---

## Pipeline State API

```
GET  /linear/status          Current queue state + active ticket
POST /linear/pipeline/start  Manually trigger a ticket
POST /linear/pipeline/stop   Abort the current ticket
GET  /linear/issues          List processable issues
POST /linear/config          Save pipeline configuration
GET  /linear/config          Get current configuration
```

---

## Further Reading

- [[Agent System]] — How the agent executes the ticket implementation
- [[Security]] — OWASP AI Security mitigations applied to the pipeline
- [[OAuth and Integrations]] — Linear API authentication
- [[API Reference]] — `/linear/*` endpoints
