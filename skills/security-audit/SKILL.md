---
name: security-audit
description: |
  Application security audit covering OWASP Top 10, STRIDE threat modeling, and secrets archaeology.
  Use when: security review, pre-launch audit, dependency scanning.
version: 1.0.0
trigger: /security
category: development
icon: shield
---

> When generating output, use the user's preferred language for all headings, labels, and prose.

## Overview

A comprehensive application security audit methodology. Covers code-level vulnerabilities, architectural threats, and supply chain risks.

## Phase 1: Threat Model (STRIDE)

Before scanning code, understand the attack surface:

| Threat | Question | Example |
|--------|----------|---------|
| **S**poofing | Can someone pretend to be another user? | Missing auth, weak session management |
| **T**ampering | Can someone modify data in transit or at rest? | Unsigned cookies, unvalidated input |
| **R**epudiation | Can actions be denied without evidence? | Missing audit logs |
| **I**nformation Disclosure | Can sensitive data leak? | Verbose errors, debug endpoints |
| **D**enial of Service | Can the system be overwhelmed? | Missing rate limits, unbounded queries |
| **E**levation of Privilege | Can someone gain unauthorized access? | Broken access control, IDOR |

## Phase 2: OWASP Top 10 Scan

Check each vulnerability category systematically:

### A01: Broken Access Control
- [ ] Authorization checks on every endpoint
- [ ] No IDOR (Insecure Direct Object Reference) vulnerabilities
- [ ] CORS policy properly configured
- [ ] Directory traversal protections

### A02: Cryptographic Failures
- [ ] Sensitive data encrypted at rest and in transit
- [ ] Strong algorithms (no MD5/SHA1 for security)
- [ ] Proper key management (no hardcoded keys)

### A03: Injection
- [ ] SQL injection — parameterized queries everywhere
- [ ] Command injection — no user input in shell commands
- [ ] XSS — output encoding in templates
- [ ] LDAP/NoSQL injection where applicable

### A04: Insecure Design
- [ ] Rate limiting on authentication endpoints
- [ ] Account lockout after failed attempts
- [ ] Secure defaults (deny by default)

### A05: Security Misconfiguration
- [ ] Debug mode disabled in production
- [ ] Default credentials changed
- [ ] Error messages don't leak stack traces
- [ ] Unnecessary features/endpoints removed

### A06: Vulnerable Components
- [ ] Dependencies have no known CVEs
- [ ] Dependencies are actively maintained
- [ ] Lockfile integrity verified

### A07: Authentication Failures
- [ ] Strong password requirements
- [ ] MFA available for sensitive operations
- [ ] Session management secure (httpOnly, secure, sameSite)

### A08: Data Integrity Failures
- [ ] CI/CD pipeline integrity
- [ ] Dependency integrity verification
- [ ] Unsigned data deserialization guarded

### A09: Logging Failures
- [ ] Security events logged (login, access denied, errors)
- [ ] Logs don't contain sensitive data
- [ ] Log injection prevented

### A10: SSRF
- [ ] User-supplied URLs validated
- [ ] Internal network access blocked
- [ ] Cloud metadata endpoints blocked

## Phase 3: Secrets Archaeology

Scan for hardcoded credentials and leaked secrets:

1. **Pattern scan** — Search codebase for:
   - API keys, tokens, passwords in source code
   - `.env` files committed to git
   - Private keys or certificates
   - Connection strings with credentials

2. **Git history** — Check if secrets were ever committed:
   - `git log --all -p | grep -i "password\|secret\|key\|token"`
   - Check for `.env` files in history even if now in `.gitignore`

3. **Configuration files** — Verify:
   - `.gitignore` includes sensitive files
   - Environment variables used for secrets
   - No secrets in CI/CD configuration

## Phase 4: Dependency Audit

1. Check for known CVEs in dependencies
2. Review dependency age and maintenance status
3. Assess permission scope of packages
4. Verify no typosquatting in package names

## Output Format

```
## Security Audit Report

**Scope**: [what was audited]
**Date**: [audit date]
**Risk Level**: Critical | High | Medium | Low

### Findings

#### [CRITICAL] Finding Title
- **Vulnerability**: [type, e.g., SQL Injection]
- **Location**: [file:line]
- **Impact**: [what an attacker could do]
- **CWE**: [CWE reference if applicable]
- **Remediation**: [specific fix]

### Summary
| Severity | Count |
|----------|-------|
| Critical | N |
| High | N |
| Medium | N |
| Low | N |
```
