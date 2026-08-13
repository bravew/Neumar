import type {
  AgentQuestion,
  QuestionGate,
  QuestionPolicy,
} from '@/shared/hooks/agent-types';

const MANDATORY_GATES = new Set<QuestionGate>([
  'approval',
  'cost',
  'rights',
  'upload',
  'destructive_edit',
]);

function normalizePolicy(
  value: unknown,
  optionLabels: readonly string[],
): QuestionPolicy {
  if (!value || typeof value !== 'object') return { behavior: 'manual' };
  const raw = value as Record<string, unknown>;
  if ('gate' in raw) {
    if (
      typeof raw.gate === 'string' &&
      MANDATORY_GATES.has(raw.gate as QuestionGate)
    ) {
      return { behavior: 'manual', gate: raw.gate as QuestionGate };
    }
    return { behavior: 'manual' };
  }
  if (
    raw.behavior === 'optional' &&
    typeof raw.defaultOptionLabel === 'string' &&
    optionLabels.includes(raw.defaultOptionLabel)
  ) {
    return {
      behavior: 'optional',
      defaultOptionLabel: raw.defaultOptionLabel,
    };
  }
  return { behavior: 'manual' };
}

function normalizeQuestion(value: unknown): AgentQuestion | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.question !== 'string' ||
    typeof raw.header !== 'string' ||
    !Array.isArray(raw.options) ||
    raw.options.length < 2 ||
    raw.options.length > 4
  ) {
    return null;
  }
  const options = raw.options.map((value) => {
    if (!value || typeof value !== 'object') return null;
    const option = value as Record<string, unknown>;
    if (typeof option.label !== 'string') return null;
    return {
      label: option.label,
      description:
        typeof option.description === 'string' ? option.description : '',
    };
  });
  if (options.some((option) => option === null)) return null;
  const validOptions = options.filter((option) => option !== null);
  return {
    question: raw.question,
    header: raw.header,
    options: validOptions,
    multiSelect: raw.multiSelect === true,
    policy: normalizePolicy(
      raw.policy,
      validOptions.map((option) => option.label),
    ),
  };
}

export function normalizeAgentQuestions(value: unknown): AgentQuestion[] {
  const questions =
    value && typeof value === 'object'
      ? (value as { questions?: unknown }).questions
      : undefined;
  if (
    !Array.isArray(questions) ||
    questions.length < 1 ||
    questions.length > 4
  ) {
    return [];
  }
  const normalized = questions.map(normalizeQuestion);
  return normalized.some((question) => question === null)
    ? []
    : normalized.filter((question) => question !== null);
}

export function defaultQuestionAnswers(
  questions: readonly AgentQuestion[],
): Record<string, string> | null {
  if (questions.length === 0) return null;
  const answers: Record<string, string> = {};
  for (const question of questions) {
    if (question.policy.behavior !== 'optional') return null;
    answers[question.question] = question.policy.defaultOptionLabel;
  }
  return answers;
}
