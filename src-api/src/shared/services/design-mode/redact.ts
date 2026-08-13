import path from 'node:path';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-ant-[A-Za-z0-9_-]+\b/g, '<redacted:anthropic-key>'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '<redacted:api-key>'],
  [/\bpk_[A-Za-z0-9_-]{16,}\b/g, '<redacted:public-key>'],
  [/\bxox[abp]-[A-Za-z0-9-]+\b/g, '<redacted:slack-token>'],
  [/\bgh[psour]_[A-Za-z0-9_]{20,}\b/g, '<redacted:github-token>'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '<redacted:aws-key>'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<redacted:jwt>'],
  [
    /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
    'Authorization: Bearer <redacted>',
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, 'Bearer <redacted>'],
];

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const UNIX_PATH_RE = /(?:^|[\s"'=:(])((?:\/Users|\/home)\/[^\s"'<>),;]+)/g;
const WINDOWS_PATH_RE = /(?:^|[\s"'=:(])([A-Z]:\\[^\s"'<>),;]+)/g;
const SECRET_KEY_RE =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|client[_-]?secret)/i;
const DEFAULT_MAX_STRING_LENGTH = 4096;
const DEFAULT_MAX_ARRAY_ITEMS = 50;

export interface RedactionOptions {
  sendIdentity?: boolean;
  workspaceRoot?: string;
  maxStringLength?: number;
  maxArrayItems?: number;
}

export function redactDesignTelemetryPayload<T>(
  payload: T,
  options: RedactionOptions = {},
): T {
  return redactValue(payload, options, null) as T;
}

function redactValue(
  value: unknown,
  options: RedactionOptions,
  key: string | null,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (key && SECRET_KEY_RE.test(key)) return '<redacted:secret>';
    return redactString(value, options);
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const limit = options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS;
    const items = value
      .slice(0, limit)
      .map((item) => redactValue(item, options, key));
    if (value.length > limit) {
      items.push(`<truncated:${value.length - limit} items>`);
    }
    return items;
  }

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = redactValue(childValue, options, childKey);
  }
  return output;
}

function redactString(value: string, options: RedactionOptions): string {
  let next = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    next = next.replace(pattern, replacement);
  }
  next = redactPaths(next, options.workspaceRoot);
  if (options.sendIdentity !== true) {
    next = next.replace(EMAIL_RE, '<redacted:email>');
  }
  const maxLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;
  if (next.length > maxLength) {
    return `${next.slice(0, maxLength)}...<truncated:${next.length - maxLength} chars>`;
  }
  return next;
}

function redactPaths(value: string, workspaceRoot?: string): string {
  const normalizedRoot = workspaceRoot ? path.resolve(workspaceRoot) : null;
  const workspaceRedacted = normalizedRoot
    ? value.split(normalizedRoot).join('<workspace>')
    : value;
  return workspaceRedacted
    .replace(UNIX_PATH_RE, (match, absolutePath: string) =>
      match.replace(absolutePath, redactPath(absolutePath, workspaceRoot)),
    )
    .replace(WINDOWS_PATH_RE, (match, absolutePath: string) =>
      match.replace(absolutePath, redactPath(absolutePath, workspaceRoot)),
    );
}

function redactPath(absolutePath: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return '<workspace>';
  const normalizedRoot = path.resolve(workspaceRoot);
  const normalizedPath = path.resolve(absolutePath);
  if (normalizedPath === normalizedRoot) return '<workspace>';
  if (normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return `<workspace>/${path
      .relative(normalizedRoot, normalizedPath)
      .split(path.sep)
      .join('/')}`;
  }
  return '<workspace>';
}
