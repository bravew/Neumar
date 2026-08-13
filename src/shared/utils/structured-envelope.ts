// Kept in sync with src-api/src/shared/utils/structured-envelope.ts.
// Workspace path aliases are isolated; update both copies together.
export type StructuredEnvelope =
  | { type: 'direct_answer'; answer: string }
  | { type: 'plan'; value: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractJsonPayload(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) return trimmed;
  if (!trimmed.startsWith('```')) return null;

  const firstLineEnd = trimmed.indexOf('\n');
  if (firstLineEnd === -1) return null;

  const fenceLanguage = trimmed.slice(3, firstLineEnd).trim().toLowerCase();
  if (fenceLanguage && fenceLanguage !== 'json') return null;

  const closingFence = trimmed.lastIndexOf('```');
  if (closingFence <= firstLineEnd) return null;
  if (trimmed.slice(closingFence + 3).trim()) return null;

  return trimmed.slice(firstLineEnd + 1, closingFence).trim();
}

export function parseStructuredEnvelope(
  content: string,
): StructuredEnvelope | null {
  const payload = extractJsonPayload(content);
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRecord(parsed)) return null;

    if (parsed.type === 'direct_answer' && typeof parsed.answer === 'string') {
      return { type: 'direct_answer', answer: parsed.answer };
    }

    if (parsed.type === 'plan' && ('steps' in parsed || 'goal' in parsed)) {
      return { type: 'plan', value: parsed };
    }
  } catch {
    return null;
  }

  return null;
}

export function extractStructuredDirectAnswer(content: string): string | null {
  const envelope = parseStructuredEnvelope(content);
  return envelope?.type === 'direct_answer' ? envelope.answer : null;
}

export function isStructuredPlanEnvelope(content: string): boolean {
  return parseStructuredEnvelope(content)?.type === 'plan';
}
