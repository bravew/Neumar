/**
 * Delegation Service
 *
 * Manages agent-to-agent task delegation with depth control,
 * delegate restrictions, and config resolution.
 */

import crypto from 'crypto';

import type { AgentConfig } from '@/core/agent/types';

import {
  createActivityEvent,
  createTask,
  createTaskLink,
  getAgentProfile,
  getTask,
  getSetting,
} from '@/shared/db/operations';
import type { AgentProfile } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Delegation');

export interface DelegationRequest {
  prompt: string;
  assigneeProfileId: string;
  depth?: number;
}

/**
 * Delegation Service — manages task delegation between agent profiles.
 */
export class DelegationService {
  /**
   * Delegate a task to another agent profile.
   * Returns the child task ID.
   */
  delegate(parentTaskId: string, request: DelegationRequest): string {
    // Validate parent task exists
    const parentTask = getTask(parentTaskId);
    if (!parentTask) {
      throw new Error(`Parent task not found: ${parentTaskId}`);
    }

    // Validate assignee profile exists and is active
    const assigneeProfile = getAgentProfile(request.assigneeProfileId);
    if (!assigneeProfile) {
      throw new Error(
        `Assignee profile not found: ${request.assigneeProfileId}`,
      );
    }
    if (assigneeProfile.status !== 'active') {
      throw new Error(
        `Assignee profile '${assigneeProfile.name}' is not active (status: ${assigneeProfile.status})`,
      );
    }

    // Check depth limit
    const currentDepth = request.depth ?? this.getDelegationDepth(parentTaskId);
    if (currentDepth >= assigneeProfile.max_delegation_depth) {
      throw new Error(
        `Delegation depth limit exceeded (${currentDepth} >= ${assigneeProfile.max_delegation_depth})`,
      );
    }

    // Check allowed delegates (if parent task has an assignee profile)
    if (parentTask.assignee_profile_id) {
      const parentProfile = getAgentProfile(parentTask.assignee_profile_id);
      if (parentProfile?.allowed_delegates) {
        let allowedIds: string[] = [];
        try {
          const parsed = JSON.parse(parentProfile.allowed_delegates);
          allowedIds = Array.isArray(parsed) ? parsed : [];
        } catch {
          logger.warn(
            `Malformed allowed_delegates for profile ${parentProfile.id}, treating as unrestricted`,
          );
        }
        if (
          allowedIds.length > 0 &&
          !allowedIds.includes(request.assigneeProfileId)
        ) {
          throw new Error(
            `Profile '${assigneeProfile.name}' is not in the allowed delegates list`,
          );
        }
      }
    }

    // Create child task
    const childTaskId = crypto.randomUUID();
    createTask({
      id: childTaskId,
      session_id: parentTask.session_id,
      task_index: 0,
      prompt: request.prompt,
      work_dir: parentTask.work_dir ?? undefined,
      parent_task_id: parentTaskId,
    });

    // Create parent-child link (uses Tier 1 task_links)
    createTaskLink({
      id: crypto.randomUUID(),
      from_task_id: parentTaskId,
      to_task_id: childTaskId,
      link_type: 'parent_child',
    });

    // Emit activity event (uses Tier 1 activity_events)
    createActivityEvent({
      id: crypto.randomUUID(),
      actor_type: 'agent',
      actor_id: parentTask.assignee_profile_id || 'system',
      event_type: 'task.delegated',
      entity_type: 'task',
      entity_id: childTaskId,
      project_id: parentTask.project_id || undefined,
      metadata: JSON.stringify({
        parentTaskId,
        assigneeProfileId: request.assigneeProfileId,
        depth: currentDepth + 1,
      }),
    });

    logger.info(
      `Delegated task ${childTaskId} from ${parentTaskId} to profile ${assigneeProfile.name} (depth: ${currentDepth + 1})`,
    );

    return childTaskId;
  }

  /**
   * Get the delegation depth of a task by walking the parent chain.
   */
  getDelegationDepth(taskId: string): number {
    let depth = 0;
    let currentId: string | null = taskId;

    while (currentId) {
      const task = getTask(currentId);
      if (!task?.parent_task_id) break;
      currentId = task.parent_task_id;
      depth++;
      // Safety: prevent infinite loops
      if (depth > 100) break;
    }

    return depth;
  }
}

// ============================================================================
// Config Resolution
// ============================================================================

/**
 * Resolve agent configuration with priority chain:
 * Task override > Profile defaults > Global settings
 */
export function resolveAgentConfig(
  taskConfig: Partial<AgentConfig>,
  profile?: AgentProfile | null,
  globalSettings?: Record<string, string | null>,
): AgentConfig {
  const defaults = globalSettings || {};

  return {
    provider:
      taskConfig.provider ??
      (profile?.default_provider as AgentConfig['provider']) ??
      (defaults.defaultProvider as AgentConfig['provider']) ??
      'claude',
    model:
      taskConfig.model ??
      profile?.default_model ??
      (defaults.defaultModel as string | undefined),
    apiKey: taskConfig.apiKey,
    baseUrl: taskConfig.baseUrl,
    workDir:
      taskConfig.workDir ??
      ((getSetting('workDir') as string | null) || undefined),
  };
}

/** Singleton delegation service */
let delegationService: DelegationService | null = null;

export function getDelegationService(): DelegationService {
  if (!delegationService) {
    delegationService = new DelegationService();
  }
  return delegationService;
}
