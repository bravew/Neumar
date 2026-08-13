# Security Policy

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately using [GitHub Security Advisories](../../security/advisories/new) for this repository. If you're unable to use that channel, email the maintainers at the contact address listed on the repository's GitHub profile.

Include as much detail as you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof-of-concept
- Affected version/commit

We'll acknowledge your report and work with you on a fix and disclosure timeline before any public details are shared.

## Scope

Neumar runs local-first with workspace-scoped file access and stores provider credentials via the OS keychain / Tauri Stronghold. Reports of particular interest include:

- Workspace sandbox escapes (file operations reaching outside the configured workspace directory)
- Credential or API key exposure (logs, error messages, IPC, network requests)
- SSRF via user-supplied URLs in server-side `fetch()` calls
- Injection vulnerabilities in the API (`src-api/`) or channel integrations (Slack, Discord, Telegram, Lark)

## Automated scanning

This repository runs dependency review and `npm audit` on every PR, plus an AI-assisted security review (`.github/workflows/security.yml`), which you can also trigger manually with the "Security Review" label.
