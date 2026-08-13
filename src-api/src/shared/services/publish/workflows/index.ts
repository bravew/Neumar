import type { PublishWorkflow } from './types';
import { postWorkflowV1 } from './v1.0.0/post.workflow';

export const DEFAULT_PUBLISH_WORKFLOW_VERSION = postWorkflowV1.version;

const workflows = new Map<string, PublishWorkflow>([
  [postWorkflowV1.version, postWorkflowV1],
]);

export function registerPublishWorkflow(workflow: PublishWorkflow): void {
  workflows.set(workflow.version, workflow);
}

export function getPublishWorkflow(
  version: string,
): PublishWorkflow | undefined {
  return workflows.get(version);
}

export function resolvePublishWorkflow(
  version = DEFAULT_PUBLISH_WORKFLOW_VERSION,
): PublishWorkflow {
  const workflow = getPublishWorkflow(version);
  if (!workflow) {
    throw new Error(`Unknown publish workflow version: ${version}`);
  }
  return workflow;
}
