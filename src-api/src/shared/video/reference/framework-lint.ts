import type { TranscriptData } from '@/shared/video/types';

export const FRAMEWORK_TRANSCRIPT_RUN_TOKENS = 8;

export class FrameworkLintError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'archive-path'
      | 'content-hash'
      | 'data-uri'
      | 'transcript-run' = 'archive-path',
    readonly field?: string,
  ) {
    super(message);
    this.name = 'FrameworkLintError';
  }
}

export function lintFramework(
  subject: unknown,
  input: {
    referenceId: string;
    contentHash?: string;
    transcript?: TranscriptData | null;
  },
): void {
  const archiveNeedle = `references/${input.referenceId}/`;
  walk(subject, '', (value, field) => {
    if (value.includes(archiveNeedle) || value.includes('/references/')) {
      throw new FrameworkLintError(
        `Reference archive path leaked into ${field || 'framework'}.`,
        'archive-path',
        field,
      );
    }
    if (input.contentHash && value.includes(input.contentHash)) {
      throw new FrameworkLintError(
        `Reference contentHash leaked into ${field || 'framework'}.`,
        'content-hash',
        field,
      );
    }
    if (/data:[^;]+;base64,/i.test(value)) {
      throw new FrameworkLintError(
        `Data URI leaked into ${field || 'framework'}.`,
        'data-uri',
        field,
      );
    }
  });
  if (input.transcript) {
    const fullText = [
      ...input.transcript.words.map((word) => word.text),
      ...input.transcript.segments.map((segment) => segment.text),
    ].join(' ');
    if (fullText.trim()) assertNoTranscriptRun(subject, fullText);
  }
}

function assertNoTranscriptRun(subject: unknown, fullText: string): void {
  const tokens = tokenize(fullText);
  if (tokens.length < FRAMEWORK_TRANSCRIPT_RUN_TOKENS) return;
  const windows = new Set<string>();
  for (let i = 0; i <= tokens.length - FRAMEWORK_TRANSCRIPT_RUN_TOKENS; i++) {
    windows.add(tokens.slice(i, i + FRAMEWORK_TRANSCRIPT_RUN_TOKENS).join(' '));
  }
  walk(subject, '', (value, field) => {
    if (!isSensitiveField(field)) return;
    const haystack = tokenize(value).join(' ');
    for (const window of windows) {
      if (haystack.includes(window)) {
        throw new FrameworkLintError(
          `Verbatim transcript run leaked into ${field}.`,
          'transcript-run',
          field,
        );
      }
    }
  });
}

function isSensitiveField(field: string): boolean {
  return /(purpose|promptTemplate|textTemplate|queryTemplate|displayName)$/.test(
    field,
  );
}

function walk(
  value: unknown,
  path: string,
  visit: (text: string, field: string) => void,
): void {
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      walk(nested, path ? `${path}.${key}` : key, visit);
    }
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}
