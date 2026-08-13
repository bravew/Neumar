/**
 * AskUserQuestion payload schema.
 *
 * Mirrors the frontend's `AgentQuestion` shape (`src/shared/hooks/agent-types.ts`)
 * so the synthetic AG-UI tool_use event we emit is structurally identical to
 * what the Claude Agent SDK's native AskUserQuestion would produce.
 */

export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export type AskUserQuestionGate =
  | 'approval'
  | 'cost'
  | 'rights'
  | 'upload'
  | 'destructive_edit';

export type AskUserQuestionPolicy =
  | { behavior: 'manual'; gate?: AskUserQuestionGate }
  | { behavior: 'optional'; defaultOptionLabel: string };

export interface AskUserQuestion {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
  policy: AskUserQuestionPolicy;
}

export interface AskUserQuestionPayload {
  questions: AskUserQuestion[];
}
