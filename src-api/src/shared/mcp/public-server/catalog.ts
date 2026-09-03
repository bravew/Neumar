/**
 * Frozen inbound MCP tool catalog: names, titles, annotations, and schemas.
 * Order is the public tools/list order.
 */

import type { z } from 'zod';

import {
  addTaskCommentInputSchema,
  addTaskCommentOutputSchema,
  cancelAgentRunInputSchema,
  cancelAgentRunOutputSchema,
  createProjectInputSchema,
  createProjectOutputSchema,
  createTaskInputSchema,
  createTaskOutputSchema,
  getAgentRunInputSchema,
  getAgentRunOutputSchema,
  getProjectInputSchema,
  getProjectOutputSchema,
  getRunTreeInputSchema,
  getRunTreeOutputSchema,
  getTaskInputSchema,
  getTaskOutputSchema,
  healthInputSchema,
  healthOutputSchema,
  listProjectsInputSchema,
  listProjectsOutputSchema,
  listTasksInputSchema,
  listTasksOutputSchema,
  searchTasksInputSchema,
  searchTasksOutputSchema,
  startAgentRunInputSchema,
  startAgentRunOutputSchema,
  updateTaskInputSchema,
  updateTaskOutputSchema,
} from './schemas';

export const PUBLIC_MCP_SERVER_NAME = 'neumar';

export const READ_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const ADDITIVE_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const IDEMPOTENT_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export type PublicToolSide = 'read' | 'write' | 'run';

export interface PublicToolDefinition {
  name: string;
  title: string;
  description: string;
  side: PublicToolSide;
  annotations:
    | typeof READ_ANNOTATIONS
    | typeof ADDITIVE_WRITE_ANNOTATIONS
    | typeof IDEMPOTENT_WRITE_ANNOTATIONS;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
}

export const PUBLIC_TOOL_CATALOG: readonly PublicToolDefinition[] = [
  {
    name: 'neumar_health',
    title: 'Neumar health',
    description:
      'Check whether the Neumar app is reachable and which MCP features are enabled.',
    side: 'read',
    annotations: READ_ANNOTATIONS,
    inputSchema: healthInputSchema,
    outputSchema: healthOutputSchema,
  },
  {
    name: 'neumar_list_projects',
    title: 'List projects',
    description: 'List library projects with a bounded, deterministic page.',
    side: 'read',
    annotations: READ_ANNOTATIONS,
    inputSchema: listProjectsInputSchema,
    outputSchema: listProjectsOutputSchema,
  },
  {
    name: 'neumar_get_project',
    title: 'Get project',
    description:
      'Get one library project by exact UUID, or by a unique case-insensitive name.',
    side: 'read',
    annotations: READ_ANNOTATIONS,
    inputSchema: getProjectInputSchema,
    outputSchema: getProjectOutputSchema,
  },
  {
    name: 'neumar_list_tasks',
    title: 'List tasks',
    description: 'List library tasks with optional project and status filters.',
    side: 'read',
    annotations: READ_ANNOTATIONS,
    inputSchema: listTasksInputSchema,
    outputSchema: listTasksOutputSchema,
  },
  {
    name: 'neumar_search_tasks',
    title: 'Search tasks',
    description: 'Literal search of task titles and prompts.',
    side: 'read',
    annotations: READ_ANNOTATIONS,
    inputSchema: searchTasksInputSchema,
    outputSchema: searchTasksOutputSchema,
  },
  {
    name: 'neumar_get_task',
    title: 'Get task',
    description:
      'Get one task by exact ID, optionally with a bounded message page and file metadata.',
    side: 'read',
    annotations: READ_ANNOTATIONS,
    inputSchema: getTaskInputSchema,
    outputSchema: getTaskOutputSchema,
  },
  {
    name: 'neumar_get_run_tree',
    title: 'Get run tree',
    description: 'Get the durable agent-run tree for one task.',
    side: 'read',
    annotations: READ_ANNOTATIONS,
    inputSchema: getRunTreeInputSchema,
    outputSchema: getRunTreeOutputSchema,
  },
  {
    name: 'neumar_create_project',
    title: 'Create project',
    description:
      'Create a library project. Reuse requestId with the same payload to replay the result.',
    side: 'write',
    annotations: ADDITIVE_WRITE_ANNOTATIONS,
    inputSchema: createProjectInputSchema,
    outputSchema: createProjectOutputSchema,
  },
  {
    name: 'neumar_create_task',
    title: 'Create task',
    description:
      'Create a session and task atomically. Reuse requestId with the same payload to replay the result.',
    side: 'write',
    annotations: ADDITIVE_WRITE_ANNOTATIONS,
    inputSchema: createTaskInputSchema,
    outputSchema: createTaskOutputSchema,
  },
  {
    name: 'neumar_update_task',
    title: 'Update task',
    description:
      'Update title, priority, labels, blocked reason, or project on an exact task ID.',
    side: 'write',
    annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    inputSchema: updateTaskInputSchema,
    outputSchema: updateTaskOutputSchema,
  },
  {
    name: 'neumar_add_task_comment',
    title: 'Add task comment',
    description: 'Add an agent-attributed comment to an exact task ID.',
    side: 'write',
    annotations: ADDITIVE_WRITE_ANNOTATIONS,
    inputSchema: addTaskCommentInputSchema,
    outputSchema: addTaskCommentOutputSchema,
  },
  {
    name: 'neumar_start_agent_run',
    title: 'Start agent run',
    description:
      'Start a durable Neumar agent run and return immediately with a runId.',
    side: 'run',
    annotations: ADDITIVE_WRITE_ANNOTATIONS,
    inputSchema: startAgentRunInputSchema,
    outputSchema: startAgentRunOutputSchema,
  },
  {
    name: 'neumar_get_agent_run',
    title: 'Get agent run',
    description:
      'Read durable status for one agent run, including awaiting_input.',
    side: 'run',
    annotations: READ_ANNOTATIONS,
    inputSchema: getAgentRunInputSchema,
    outputSchema: getAgentRunOutputSchema,
  },
  {
    name: 'neumar_cancel_agent_run',
    title: 'Cancel agent run',
    description: 'Request cooperative cancellation of an exact run ID.',
    side: 'run',
    annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    inputSchema: cancelAgentRunInputSchema,
    outputSchema: cancelAgentRunOutputSchema,
  },
];

export const PUBLIC_TOOL_NAMES = PUBLIC_TOOL_CATALOG.map((tool) => tool.name);

export const SAFE_READ_TOOL_NAMES = new Set(
  PUBLIC_TOOL_CATALOG.filter((tool) => tool.annotations.readOnlyHint).map(
    (tool) => tool.name,
  ),
);

export function toolsForFlags(flags: {
  writesEnabled: boolean;
  agentRunsEnabled: boolean;
}): PublicToolDefinition[] {
  return PUBLIC_TOOL_CATALOG.filter((tool) => {
    if (tool.side === 'write') return flags.writesEnabled;
    if (tool.side === 'run') return flags.agentRunsEnabled;
    return true;
  });
}
