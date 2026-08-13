import type { PublishWorkflow } from '../types';

export const postWorkflowV1: PublishWorkflow = {
  version: '1.0.0',
  kind: 'post',
  createInitialState(input) {
    return {
      version: this.version,
      kind: this.kind,
      jobId: input.jobId,
      idempotencyKey: input.idempotencyKey,
      state: input.state,
      createdAt: input.createdAt,
      destinations: input.destinations.map((destination) => ({
        kind: destination.kind,
        connectionId: destination.connectionId,
        approvalRequired: destination.approvalRequired,
        state: 'queued',
      })),
      signals: [],
    };
  },
};
