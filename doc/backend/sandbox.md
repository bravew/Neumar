---
summary: "Sandbox system — OS-level filesystem isolation via Claude SDK, sandbox registry + plugin architecture, provider capabilities, and workspace boundary enforcement"
read_when:
  - Adding a new sandbox provider
  - Understanding sandbox isolation levels
  - Working with the instance pool
  - Understanding workspace filesystem boundaries
  - Debugging filesystem access issues
title: "Sandbox System"
---

# Sandbox System

## OS-Level Filesystem Isolation

The primary security boundary uses the **Claude Agent SDK's native sandbox settings**, which enforce filesystem restrictions at the OS level via **macOS Seatbelt** profiles and **Linux Bubblewrap**. This is a hard boundary that cannot be bypassed by prompt injection.

### How It Works

```
User selects workspace folder ──→ Frontend resolves session folder
                               ──→ Backend builds sandbox config:
                                    buildSdkSandboxSettings(sessionCwd, userWorkspaceDir)
                               ──→ Claude SDK configures OS sandbox:
                                    sandbox.filesystem.allowWrite = [sessionCwd]
                                    sandbox.filesystem.denyWrite  = [~/.ssh, ~/.bashrc, ...]
                                    sandbox.filesystem.denyRead   = [~/.ssh, ~/.aws, ...]
                                    additionalDirectories         = [userWorkspaceDir]
```

### Configuration Flow

1. **`buildSandboxFilesystemConfig()`** in `path-validator.ts` generates the filesystem rules
2. **`buildSdkSandboxSettings()`** in `claude/index.ts` wraps these into the SDK's `SandboxSettings` format
3. The SDK passes these to the OS sandbox runtime which enforces them at kernel level

### Filesystem Boundaries

| Boundary | Paths | Effect |
|----------|-------|--------|
| `allowWrite` | Session directory, optionally user workspace | Only these paths can be written to |
| `denyWrite` | `~/.ssh`, `~/.aws`, `~/.bashrc`, `~/.zshrc`, `~/.profile`, `~/.gitconfig` | Prevents persistence attacks via shell config modification |
| `denyRead` | `~/.ssh`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.gnupg`, `~/.git-credentials`, `~/.npmrc`, `~/.pypirc`, `~/.netrc`, `~/.docker/config.json`, `~/.kube/config` | Prevents credential exfiltration |
| `additionalDirectories` | User-selected workspace folder | Grants read access beyond `cwd` |

### User Workspace Write Access

By default, the user-selected workspace folder is **read-only**. When `allowWorkspaceWrite=true` is set:
- The workspace folder is added to `allowWrite`
- The agent can modify files directly in the user's project
- This is useful for code editing tasks where the agent needs to modify source files

The `allowWorkspaceWrite` flag is passed from the frontend through the API chain:
```
Frontend (useAgent.ts) → API (agent.ts) → Service (agent.ts) → Agent (claude/index.ts)
```

### Bash Command Validation

As defense-in-depth, `validateBashCommand()` in `path-validator.ts` extracts filesystem paths from shell commands and validates them against allowed directories. This catches commands like:
- `find /Users/example -maxdepth 4` → **blocked** (outside allowed dirs)
- `ls ~/.ssh` → **blocked** (sensitive path)
- `find /workspace/session-123 -name "*.py"` → **allowed** (within session dir)

## Sandbox Registry & Plugin Architecture

The sandbox system for script execution mirrors the agent architecture with its own **registry + plugin** pattern:

```
┌──────────────────────────────────────────────┐
│               Sandbox Registry               │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Native   │  │ Claude   │  │ Codex    │  │
│  │ (process)│  │ (srt)    │  │          │  │
│  └──────────┘  └──────────┘  └──────────┘  │
└──────────────────────┬───────────────────────┘
                       │
              ┌────────▼────────┐
              │  Instance Pool  │
              │  (max 5, reuse) │
              └─────────────────┘
```

## Sandbox Capabilities

Phase 7 expanded provider metadata so callers can distinguish "runs in a
sandbox-shaped adapter" from "safe for untrusted marketplace execution." The
backend source of truth is `SandboxCapabilities` in
`src-api/src/core/sandbox/types.ts`.

| Provider | Isolation | Enforcement | Network Policy | Read Deny | Write Allowlist | Audit Events | Marketplace |
|----------|-----------|-------------|----------------|-----------|-----------------|--------------|-------------|
| **Native** | None | None | No | No | No | No | No |
| **Claude** | Process/container wrapper | Reduced | No | Yes | Yes | No | No |
| **Codex** | Process sandbox | Reduced | No | Yes | Yes | No | No |
| **Docker** | Container | Hard | Yes | Yes | Yes | Yes | Yes |
| **E2B** | VM | Hard | Yes | Yes | No | Yes | Yes |

`enforcement` is deliberately separate from `isolation`:

- `hard` means the provider can be used as a hard boundary for untrusted code.
- `reduced` means some isolation exists, but the current adapter still has
  escape paths or host-mediated behavior.
- `none` means direct host execution with no isolation guarantee.

The current built-in desktop settings surface exposes Codex as **Reduced** and
Native as **No isolation**. Both are marketplace-ineligible.

### Marketplace Execution Gate

Marketplace plugins must run on a provider whose capabilities report:

- `marketplaceEligible: true`
- `enforcement: 'hard'`
- `isolation !== 'none'`

`assertMarketplaceEligible()` rejects any provider that does not meet those
conditions. `getMarketplaceProvider()` walks provider metadata and picks the
first available hard-isolation provider; unlike normal sandbox selection, it
never falls back to Native. If none is available, it throws
`MarketplaceProviderError` with an installation/remediation message.

This prevents the historical "try Codex, then fall back to Native" behavior
from silently running untrusted marketplace code on the host.

### Shell Execution Hardening

Native, Claude, and Codex providers now default to non-shell execution:

- Native uses `spawn(command, args, { shell: false })` and rejects shell
  metacharacters in the command string.
- Claude and Codex reject shell-looking command strings unless `trustedShell`
  is explicitly enabled.
- Enabling `trustedShell` does not make a provider marketplace-eligible.

Callers that need shell behavior must opt in deliberately and pass operands via
`args[]` where possible.

## Instance Pool

The `SandboxPool` manages reusable sandbox instances:
- Maximum 5 concurrent instances (configurable)
- Acquire → use → release lifecycle
- Automatic cleanup of stale instances
- Prevents resource exhaustion during heavy task execution

## Key Files

| File | Purpose |
|------|---------|
| `src-api/src/shared/utils/path-validator.ts` | `buildSandboxFilesystemConfig()`, `validateBashCommand()` |
| `src-api/src/extensions/agent/claude/index.ts` | `buildSdkSandboxSettings()`, SDK sandbox integration |
| `src-api/src/core/sandbox/types.ts` | Sandbox provider interfaces and config types |
| `src-api/src/core/sandbox/index.ts` | Marketplace eligibility gate and provider selection helpers |
| `src-api/src/core/sandbox/plugin.ts` | Provider metadata schema and built-in Docker/E2B/Native metadata |
| `src-api/src/extensions/sandbox/native.ts` | Host execution provider with shell-disabled default |
| `src-api/src/extensions/sandbox/claude.ts` | Claude sandbox-runtime provider with trusted-shell opt-in |
| `src-api/src/extensions/sandbox/codex.ts` | Codex CLI provider with reduced-enforcement metadata |
| `src-api/src/core/agent/types.ts` | `userWorkspaceDir`, `allowWorkspaceWrite` options |

---

*See also: [Security](../security/index.md) · [Agent System](agent-system.md) · [Plugins & Extensions](../plugins/index.md)*
