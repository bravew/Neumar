import { isInsideMarkdownCodeFence } from '../markdown-code-fence';
import {
  ASK_USER_QUESTION_FENCE_RE,
  ASK_USER_QUESTION_TAG_RE,
  ASK_USER_QUESTION_FENCE_LANG,
} from './instruction';
import type {
  AskUserQuestion,
  AskUserQuestionGate,
  AskUserQuestionOption,
  AskUserQuestionPayload,
} from './schema';

const MANDATORY_GATES = new Set<AskUserQuestionGate>([
  'approval',
  'cost',
  'rights',
  'upload',
  'destructive_edit',
]);

function normalizeQuestionPolicy(
  raw: unknown,
  optionLabels: Set<string>,
): AskUserQuestion['policy'] {
  if (!raw || typeof raw !== 'object') return { behavior: 'manual' };
  const policy = raw as Record<string, unknown>;
  if ('gate' in policy) {
    if (
      typeof policy.gate === 'string' &&
      MANDATORY_GATES.has(policy.gate as AskUserQuestionGate)
    ) {
      return {
        behavior: 'manual',
        gate: policy.gate as AskUserQuestionGate,
      };
    }
    return { behavior: 'manual' };
  }
  if (
    policy.behavior !== 'optional' ||
    typeof policy.defaultOptionLabel !== 'string' ||
    !optionLabels.has(policy.defaultOptionLabel)
  ) {
    return { behavior: 'manual' };
  }
  return {
    behavior: 'optional',
    defaultOptionLabel: policy.defaultOptionLabel,
  };
}

/**
 * Validate and normalize a parsed JSON object into the strict
 * AskUserQuestionPayload shape. Returns null on any structural problem so
 * adapters can fall back to plain-text rendering.
 *
 * Constraints follow Anthropic's upstream AskUserQuestionTool:
 *   1-4 questions, each with 2-4 options, headers <=12 chars.
 */
export function validateAskUserQuestionPayload(
  raw: unknown,
): AskUserQuestionPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { questions?: unknown };
  if (!Array.isArray(obj.questions)) return null;
  if (obj.questions.length === 0 || obj.questions.length > 4) return null;

  const questions: AskUserQuestion[] = [];
  for (const q of obj.questions) {
    if (!q || typeof q !== 'object') return null;
    const item = q as {
      question?: unknown;
      header?: unknown;
      options?: unknown;
      multiSelect?: unknown;
      policy?: unknown;
    };
    if (
      typeof item.question !== 'string' ||
      typeof item.header !== 'string' ||
      item.header.length > 12 ||
      !Array.isArray(item.options) ||
      item.options.length < 2 ||
      item.options.length > 4
    ) {
      return null;
    }
    const options: AskUserQuestionOption[] = [];
    for (const opt of item.options) {
      if (!opt || typeof opt !== 'object') return null;
      const o = opt as { label?: unknown; description?: unknown };
      if (typeof o.label !== 'string' || o.label.length === 0) return null;
      options.push({
        label: o.label,
        description: typeof o.description === 'string' ? o.description : '',
      });
    }
    questions.push({
      question: item.question,
      header: item.header,
      options,
      multiSelect: item.multiSelect === true,
      policy: normalizeQuestionPolicy(
        item.policy,
        new Set(options.map((option) => option.label)),
      ),
    });
  }

  return { questions };
}

/**
 * Try to extract an AskUserQuestion payload from a finished assistant
 * message. Use this for batch adapters that get the model's response as a
 * single completed text (e.g., Codex `agent_message` items). For streaming
 * adapters use `AskUserQuestionStreamFilter` from `./stream` instead.
 */
export function tryExtractAskUserQuestion(
  text: string,
): AskUserQuestionPayload | null {
  const fenced = tryExtractFencedAskUserQuestion(text);
  if (fenced) return fenced;
  return tryExtractTaggedAskUserQuestion(text);
}

function tryParseAskUserQuestionJson(
  body: string,
): AskUserQuestionPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return validateAskUserQuestionPayload(parsed);
}

function tryExtractFencedAskUserQuestion(
  text: string,
): AskUserQuestionPayload | null {
  if (!text.includes(`\`\`\`${ASK_USER_QUESTION_FENCE_LANG}`)) return null;
  const fenceRe = new RegExp(ASK_USER_QUESTION_FENCE_RE.source, 'g');
  for (const match of text.matchAll(fenceRe)) {
    if (
      match.index !== undefined &&
      isInsideMarkdownCodeFence(text, match.index, false)
    ) {
      continue;
    }
    const parsed = tryParseAskUserQuestionJson(match[1] ?? '');
    if (parsed) return parsed;
  }
  return null;
}

function tryExtractTaggedAskUserQuestion(
  text: string,
): AskUserQuestionPayload | null {
  if (!text.includes('<question-form>') && !text.includes('<ask-question>')) {
    return null;
  }
  for (const match of text.matchAll(ASK_USER_QUESTION_TAG_RE)) {
    if (
      match.index !== undefined &&
      isInsideMarkdownCodeFence(text, match.index, false)
    ) {
      continue;
    }
    const parsed = tryParseAskUserQuestionJson(match[2] ?? '');
    if (parsed) return parsed;
  }
  return null;
}
