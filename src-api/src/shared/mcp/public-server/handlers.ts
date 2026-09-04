export interface ToolHttpMapping {
  method: 'GET' | 'POST' | 'PATCH';
  auth: boolean;
  retryable: boolean;
  pathKeys: Set<string>;
  path: (args: Record<string, unknown>) => string;
  body?: (args: Record<string, unknown>) => unknown;
}

function encodeSegment(value: unknown): string {
  return encodeURIComponent(String(value ?? ''));
}

const READ_MAPPINGS: Record<string, ToolHttpMapping> = {
  neumar_health: {
    method: 'GET',
    auth: false,
    retryable: true,
    pathKeys: new Set(),
    path: () => '/status',
  },
  neumar_list_projects: {
    method: 'GET',
    auth: true,
    retryable: true,
    pathKeys: new Set(),
    path: () => '/projects',
  },
  neumar_get_project: {
    method: 'GET',
    auth: true,
    retryable: true,
    pathKeys: new Set(['projectId']),
    path: (args) => `/projects/${encodeSegment(args.projectId)}`,
  },
  neumar_list_tasks: {
    method: 'GET',
    auth: true,
    retryable: true,
    pathKeys: new Set(),
    path: () => '/tasks',
  },
  neumar_search_tasks: {
    method: 'GET',
    auth: true,
    retryable: true,
    pathKeys: new Set(),
    path: () => '/tasks/search',
  },
  neumar_get_task: {
    method: 'GET',
    auth: true,
    retryable: true,
    pathKeys: new Set(['taskId']),
    path: (args) => `/tasks/${encodeSegment(args.taskId)}`,
  },
  neumar_get_run_tree: {
    method: 'GET',
    auth: true,
    retryable: true,
    pathKeys: new Set(['taskId']),
    path: (args) => `/tasks/${encodeSegment(args.taskId)}/run-tree`,
  },
};

const WRITE_MAPPINGS: Record<string, ToolHttpMapping> = {
  neumar_create_project: {
    method: 'POST',
    auth: true,
    retryable: false,
    pathKeys: new Set(),
    path: () => '/projects',
  },
  neumar_create_task: {
    method: 'POST',
    auth: true,
    retryable: false,
    pathKeys: new Set(),
    path: () => '/tasks',
  },
  neumar_update_task: {
    method: 'PATCH',
    auth: true,
    retryable: false,
    pathKeys: new Set(['taskId']),
    path: (args) => `/tasks/${encodeSegment(args.taskId)}`,
    body: (args) => {
      const { taskId: _taskId, ...rest } = args;
      return rest;
    },
  },
  neumar_add_task_comment: {
    method: 'POST',
    auth: true,
    retryable: false,
    pathKeys: new Set(['taskId']),
    path: (args) => `/tasks/${encodeSegment(args.taskId)}/comments`,
    body: (args) => {
      const { taskId: _taskId, ...rest } = args;
      return rest;
    },
  },
};

const RUN_MAPPINGS: Record<string, ToolHttpMapping> = {
  neumar_start_agent_run: {
    method: 'POST',
    auth: true,
    retryable: false,
    pathKeys: new Set(),
    path: () => '/runs',
  },
  neumar_get_agent_run: {
    method: 'GET',
    auth: true,
    retryable: true,
    pathKeys: new Set(['runId']),
    path: (args) => `/runs/${encodeSegment(args.runId)}`,
  },
  neumar_cancel_agent_run: {
    method: 'POST',
    auth: true,
    retryable: false,
    pathKeys: new Set(['runId']),
    path: (args) => `/runs/${encodeSegment(args.runId)}/cancel`,
  },
};

export function toolHttpMapping(toolName: string): ToolHttpMapping | undefined {
  return (
    READ_MAPPINGS[toolName] ??
    WRITE_MAPPINGS[toolName] ??
    RUN_MAPPINGS[toolName]
  );
}
