/**
 * Dangerous Pattern Detection — Defense-in-Depth Layer
 *
 * This module provides supplementary regex-based detection of dangerous shell
 * commands. It is NOT a standalone security boundary — obfuscated commands
 * (base64 -d, eval, $IFS substitution, backtick-wrapped) can bypass these
 * patterns. Primary enforcement relies on OS-level sandbox (macOS Seatbelt /
 * Linux Bubblewrap) configured via the Claude Agent SDK's sandbox settings.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DangerousPatterns');

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DangerousPatternResult {
  isDangerous: boolean;
  patterns: string[];
  severity: 'block' | 'warn';
  suggestion?: string;
}

// ── Pattern definitions (module-scope for memoization) ─────────────────────────

const DESTRUCTIVE_PATTERNS: Array<{
  re: RegExp;
  label: string;
  suggestion?: string;
}> = [
  {
    re: /\brm\s+(-[a-zA-Z]*[rf]|--recursive|--force)/,
    label: 'destructive:rm-rf',
    suggestion:
      'Use targeted rm with explicit paths instead of recursive force-delete',
  },
  {
    re: /\bdd\s+if=\/dev\//,
    label: 'destructive:dd',
    suggestion: 'Avoid raw device writes',
  },
  {
    re: /\bmkfs\b/,
    label: 'destructive:mkfs',
    suggestion: 'Filesystem creation is dangerous',
  },
  {
    re: /\bfdisk\b/,
    label: 'destructive:fdisk',
    suggestion: 'Disk partitioning is dangerous',
  },
  {
    re: /\b(>\s*\/dev\/sd|>\s*\/dev\/disk)/,
    label: 'destructive:device-write',
    suggestion: 'Writing directly to block devices is dangerous',
  },
];

const CREDENTIAL_PATTERNS: Array<{
  re: RegExp;
  label: string;
  suggestion?: string;
}> = [
  {
    re: /\bcat\b.*\.ssh\//,
    label: 'credential:ssh',
    suggestion: 'Do not read SSH private keys',
  },
  {
    re: /\bcat\b.*\.aws\//,
    label: 'credential:aws',
    suggestion: 'Do not read AWS credentials',
  },
  {
    re: /\bcat\b.*\.gnupg\//,
    label: 'credential:gpg',
    suggestion: 'Do not read GPG keys',
  },
  {
    re: /env\s*\|.*grep.*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i,
    label: 'credential:env-grep',
    suggestion: 'Do not extract secrets from environment variables',
  },
  {
    re: /\bcat\b.*\.(env|credentials|netrc|npmrc|pypirc)\b/,
    label: 'credential:config-file',
    suggestion: 'Do not read credential configuration files',
  },
];

const SYSTEM_MOD_PATTERNS: Array<{
  re: RegExp;
  label: string;
  suggestion?: string;
}> = [
  {
    re: /\bchmod\s+777\b/,
    label: 'system:chmod-777',
    suggestion: 'Use more restrictive permissions (e.g. 755 or 644)',
  },
  {
    re: /\bchown\s+root\b/,
    label: 'system:chown-root',
    suggestion: 'Avoid changing file ownership to root',
  },
  {
    re: /\bsudo\s+/,
    label: 'system:sudo',
    suggestion: 'Avoid running commands with elevated privileges',
  },
];

const EXFILTRATION_PATTERNS: Array<{
  re: RegExp;
  label: string;
  suggestion?: string;
}> = [
  {
    re: /\bcurl\b.*-d\s*@\//,
    label: 'exfiltration:curl-upload',
    suggestion: 'Do not upload local files via curl',
  },
  {
    re: /\bwget\b.*--post-file/,
    label: 'exfiltration:wget-upload',
    suggestion: 'Do not upload local files via wget',
  },
  {
    re: /\bcurl\b.*--upload-file/,
    label: 'exfiltration:curl-upload-file',
    suggestion: 'Do not upload local files via curl',
  },
];

const PROCESS_PATTERNS: Array<{
  re: RegExp;
  label: string;
  suggestion?: string;
}> = [
  {
    re: /\bkill\s+-9\s+1\b/,
    label: 'process:kill-init',
    suggestion: 'Do not kill the init process',
  },
  {
    re: /\bpkill\s+-9\b/,
    label: 'process:pkill-force',
    suggestion: 'Avoid force-killing processes indiscriminately',
  },
  {
    re: /\bkillall\s+-9\b/,
    label: 'process:killall-force',
    suggestion: 'Avoid force-killing all processes by name',
  },
];

// Severity mapping: destructive/credential → block, system/exfiltration/process → warn
const ALL_BLOCK_PATTERNS = [
  ...DESTRUCTIVE_PATTERNS,
  ...CREDENTIAL_PATTERNS,
  ...EXFILTRATION_PATTERNS,
];
const ALL_WARN_PATTERNS = [...SYSTEM_MOD_PATTERNS, ...PROCESS_PATTERNS];

// ── Tool risk classification ───────────────────────────────────────────────────

const TOOL_RISK_MAP: Record<string, 'low' | 'medium' | 'high'> = {
  Read: 'low',
  Glob: 'low',
  Grep: 'low',
  LSP: 'low',
  Skill: 'low',
  TodoWrite: 'low',
  Edit: 'low',
  Write: 'medium',
  WebFetch: 'low',
  WebSearch: 'low',
  Bash: 'medium',
  Task: 'medium',
};

// ── Sensitive file paths (module-scope per CLAUDE.md) ──────────────────────────

const SENSITIVE_WRITE_PATHS = [
  /^\/etc\//,
  /^\/usr\//,
  /^\/sys\//,
  /^\/proc\//,
  /^\/boot\//,
  /^\/System\//,
  /^\/Library\//,
  /\.ssh\//,
  /\.aws\//,
  /\.gnupg\//,
];

// ── Public API ─────────────────────────────────────────────────────────────────

export function checkBashCommand(command: string): DangerousPatternResult {
  const matched: string[] = [];
  let highestSeverity: 'block' | 'warn' = 'warn';
  let suggestion: string | undefined;

  for (const pattern of ALL_BLOCK_PATTERNS) {
    if (pattern.re.test(command)) {
      matched.push(pattern.label);
      highestSeverity = 'block';
      if (!suggestion) suggestion = pattern.suggestion;
    }
  }

  for (const pattern of ALL_WARN_PATTERNS) {
    if (pattern.re.test(command)) {
      matched.push(pattern.label);
      if (!suggestion) suggestion = pattern.suggestion;
    }
  }

  if (matched.length > 0) {
    logger.debug(
      `Dangerous patterns detected in command: ${matched.join(', ')}`,
    );
  }

  return {
    isDangerous: matched.length > 0,
    patterns: matched,
    severity: matched.length > 0 ? highestSeverity : 'warn',
    suggestion,
  };
}

export function checkFileOperation(
  toolName: string,
  path: string,
): DangerousPatternResult {
  const matched: string[] = [];
  let suggestion: string | undefined;

  if (toolName === 'Write' || toolName === 'Edit') {
    for (const pathRe of SENSITIVE_WRITE_PATHS) {
      if (pathRe.test(path)) {
        matched.push(`file:sensitive-write:${path}`);
        suggestion = `Writing to ${path} is potentially dangerous`;
      }
    }
  }

  return {
    isDangerous: matched.length > 0,
    patterns: matched,
    severity: matched.length > 0 ? 'block' : 'warn',
    suggestion,
  };
}

export function assessRiskLevel(
  toolName: string,
  input?: unknown,
): 'low' | 'medium' | 'high' {
  // MCP tools default to medium risk
  if (toolName.startsWith('mcp__')) {
    return 'medium';
  }

  const baseRisk = TOOL_RISK_MAP[toolName] ?? 'medium';

  // Escalate Bash risk if command looks dangerous
  if (
    toolName === 'Bash' &&
    input &&
    typeof input === 'object' &&
    input !== null
  ) {
    const command = (input as Record<string, unknown>).command;
    if (typeof command === 'string') {
      const result = checkBashCommand(command);
      if (result.isDangerous && result.severity === 'block') {
        return 'high';
      }
      if (result.isDangerous) {
        return 'medium';
      }
    }
  }

  return baseRisk;
}
