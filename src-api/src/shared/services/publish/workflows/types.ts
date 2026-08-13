import type { JobState } from '../state-machine';
import type { CreateJobInput } from '../types';

export interface PublishWorkflowInitialStateInput extends CreateJobInput {
  jobId: string;
  idempotencyKey: string;
  state: JobState;
  createdAt: string;
}

export interface PublishWorkflow {
  version: string;
  kind: 'post';
  createInitialState(
    input: PublishWorkflowInitialStateInput,
  ): Record<string, unknown>;
}
