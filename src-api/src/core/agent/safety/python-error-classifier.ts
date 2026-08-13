/**
 * Maps Python tracebacks emitted by `Bash` tool runs to short, actionable
 * hints fed back to the agent via a PostToolUse `systemMessage`. The agent
 * sees a 2-line directive instead of a multi-KB traceback and stops
 * brainstorming recoveries from scratch.
 *
 * Performance shape: regexes are compiled once at module load; we scan the
 * tail of stderr (last 8 KB) since Python prints the exception class on the
 * final line; we bail before walking the pattern table when no traceback
 * marker is present. Hot path is < 50 µs per Bash result.
 */

import type {
  ToolHookOutput,
  ToolLifecycleHook,
} from '../tool-lifecycle-hooks';

export type PythonErrorCategory =
  | 'network'
  | 'ssl'
  | 'http'
  | 'module'
  | 'file'
  | 'permission'
  | 'syntax'
  | 'unknown';

export interface PythonErrorClassification {
  category: PythonErrorCategory;
  exception: string;
  detail: string;
  hint: string;
}

const TRACEBACK_RE = /Traceback \(most recent call last\)/;
// Permissive pre-check so we still classify single-line errors like
// "SyntaxError: invalid syntax" (no `\b` — `SyntaxError` has no word boundary
// before `Error`, but the colon-suffix is the Python convention).
const TERSE_ERROR_RE = /(?:Error|Exception):/;

/**
 * Tail length we scan. Python tracebacks put the actual exception class on
 * the bottom; the head is mostly call-stack noise that doesn't help
 * classification.
 */
const MAX_SCAN_BYTES = 8 * 1024;

interface PatternRule {
  re: RegExp;
  build: (m: RegExpExecArray) => PythonErrorClassification;
}

const PATTERNS: readonly PatternRule[] = [
  {
    re: /ssl\.SSLCertVerificationError[^\n]*/,
    build: (m) => ({
      category: 'ssl',
      exception: 'SSLCertVerificationError',
      detail: m[0],
      hint: 'TLS cert validation failed. Run `python3 -m pip install --upgrade certifi` and retry once. Do NOT disable verification.',
    }),
  },
  {
    re: /urllib\.error\.HTTPError: HTTP Error (\d+)/,
    build: (m) => ({
      category: 'http',
      exception: 'HTTPError',
      detail: `HTTP ${m[1]}`,
      hint: `Server returned HTTP ${m[1]}. For 4xx, fix the URL/credentials before retrying — repeated retries won't help.`,
    }),
  },
  {
    re: /(URLError: <urlopen error[^>]+>|ConnectionRefusedError|getaddrinfo failed|Name or service not known|Temporary failure in name resolution|nodename nor servname provided)/,
    build: (m) => ({
      category: 'network',
      exception: 'URLError',
      detail: m[0],
      hint: 'Network unreachable. The desktop sandbox may block outbound HTTP. Switch to a local file, ask the user before retrying, and retry the same URL at most once.',
    }),
  },
  {
    re: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/,
    build: (m) => ({
      category: 'module',
      exception: 'ModuleNotFoundError',
      detail: m[1] ?? '',
      hint: `Missing package "${m[1]}". Prefer the project's venv (\`uv run\` / \`.venv/bin/python\`) or run \`python3 -m pip install --user ${m[1]}\`, then retry once.`,
    }),
  },
  {
    re: /FileNotFoundError: \[Errno 2\] No such file or directory: ['"]([^'"]+)['"]/,
    build: (m) => ({
      category: 'file',
      exception: 'FileNotFoundError',
      detail: m[1] ?? '',
      hint: `Path "${m[1]}" not found. Resolve relative paths against the workspace root before retrying — do not blindly retry.`,
    }),
  },
  {
    re: /PermissionError: \[Errno 13\][^\n]*['"]([^'"]+)['"]/,
    build: (m) => ({
      category: 'permission',
      exception: 'PermissionError',
      detail: m[1] ?? '',
      hint: `No permission for "${m[1]}". Stay inside the workspace; never \`chmod\` system paths.`,
    }),
  },
  {
    re: /(SyntaxError|IndentationError|TabError): ([^\n]+)/,
    build: (m) => ({
      category: 'syntax',
      exception: m[1] ?? 'SyntaxError',
      detail: m[2] ?? '',
      hint: 'Python syntax error in the script you just wrote. Re-read the file at the indicated line and patch — do not regenerate from scratch.',
    }),
  },
];

/**
 * Returns a classification for a recognized Python error in `stderr`, or
 * `null` if nothing matches. Pure function; safe to call from hot paths.
 */
export function classifyPythonError(
  stderr: string,
): PythonErrorClassification | null {
  if (!stderr) return null;
  const tail =
    stderr.length > MAX_SCAN_BYTES
      ? stderr.slice(stderr.length - MAX_SCAN_BYTES)
      : stderr;
  if (!TRACEBACK_RE.test(tail) && !TERSE_ERROR_RE.test(tail)) return null;
  for (const rule of PATTERNS) {
    const m = rule.re.exec(tail);
    if (m) return rule.build(m);
  }
  return null;
}

/** Shape of the SDK's `tool_response` payload for `Bash`. Optional fields. */
interface BashToolResponse {
  stdout?: string;
  stderr?: string;
  output?: string; // some runtimes flatten stdout+stderr here
  is_error?: boolean;
  exit_code?: number;
  interrupted?: boolean;
}

function isFailure(r: BashToolResponse): boolean {
  if (r.is_error === true) return true;
  if (typeof r.exit_code === 'number' && r.exit_code !== 0) return true;
  return false;
}

/**
 * PostToolUse hook factory. Registered against `Bash` only. Returns
 * `action: 'allow'` regardless — we never block; we only attach a hint.
 */
export const pythonErrorHintHook: ToolLifecycleHook = {
  event: 'post_tool_use',
  matcher: 'Bash',
  priority: 10,
  handler: async ({ toolResult }): Promise<ToolHookOutput> => {
    if (!toolResult || typeof toolResult !== 'object') {
      return { action: 'allow' };
    }
    const r = toolResult as BashToolResponse;
    if (!isFailure(r)) return { action: 'allow' };

    const text = (r.stderr ?? '') + '\n' + (r.stdout ?? r.output ?? '');
    const cls = classifyPythonError(text);
    if (!cls) return { action: 'allow' };

    return {
      action: 'allow',
      systemMessage: `[python-error-hint] ${cls.exception}${cls.detail ? `: ${cls.detail}` : ''}\n${cls.hint}`,
    };
  },
};
