/** Serialized mirror of the backend RunMode. Do not import across workspaces. */
export type RunModeDto = 'task' | 'design' | 'video';

export type RecoveryActionDto =
  | 'retry'
  | 'continue'
  | 'answer_question'
  | 'switch_runtime'
  | 'resume_after_restart';

export interface RunContextEnvelopeDto {
  mode: RunModeDto;
  projectId: string | null;
  conversationId: string | null;
  clientRequestId: string;
  messageId: string;
  supplementalSkillIds: string[];
  recovery?: {
    executionId: string;
    sourceRunId: string;
    action: RecoveryActionDto;
  };
}
