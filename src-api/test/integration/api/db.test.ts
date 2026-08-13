import { describe, expect, it, vi } from 'vitest';

// ---- Mock all db operations ----

const mockTask = {
  id: 'task-1',
  title: 'Test Task',
  status: 'completed',
  prompt: 'Build something',
  model: 'claude-3-5-sonnet-20241022',
  created_at: '2026-04-06T00:00:00Z',
  updated_at: '2026-04-06T00:00:00Z',
};

const mockSession = {
  id: 'session-1',
  task_count: 1,
  created_at: '2026-04-06T00:00:00Z',
};

const mockMessage = {
  id: 'msg-1',
  task_id: 'task-1',
  role: 'assistant',
  type: 'text',
  content: 'Hello world',
  created_at: '2026-04-06T00:00:00Z',
};

const mockProfile = {
  id: 'prof-1',
  name: 'Test Agent',
  model: 'claude-3-5-sonnet-20241022',
  status: 'active',
};

const mockProject = {
  id: 'proj-1',
  name: 'Test Project',
  status: 'active',
};

vi.mock('@/shared/db/operations', () => ({
  // Tasks
  createTask: vi.fn().mockReturnValue(mockTask),
  getTask: vi
    .fn()
    .mockImplementation((id: string) =>
      id === 'task-1' ? mockTask : undefined,
    ),
  getTasks: vi.fn().mockReturnValue([mockTask]),
  getAllTasks: vi.fn().mockReturnValue([mockTask]),
  updateTask: vi.fn().mockReturnValue({ ...mockTask, title: 'Updated' }),
  deleteTask: vi.fn().mockReturnValue(true),
  batchDeleteTasks: vi.fn().mockReturnValue(1),
  searchTasks: vi.fn().mockReturnValue([mockTask]),

  // Sessions
  createSession: vi.fn().mockReturnValue(mockSession),
  getSession: vi
    .fn()
    .mockImplementation((id: string) =>
      id === 'session-1' ? mockSession : undefined,
    ),
  getSessions: vi.fn().mockReturnValue([mockSession]),
  getAllSessions: vi.fn().mockReturnValue([mockSession]),
  updateSessionTaskCount: vi.fn(),
  getSessionTasks: vi.fn().mockReturnValue([mockTask]),

  // Messages
  createMessage: vi.fn().mockReturnValue(mockMessage),
  getMessagesByTaskId: vi.fn().mockReturnValue([mockMessage]),
  deleteMessagesByTaskId: vi.fn().mockReturnValue(1),
  deleteMessagesAfter: vi.fn().mockReturnValue(2),
  updateMessageContent: vi.fn().mockReturnValue(true),
  updateTaskFromMessage: vi.fn(),

  // Files
  createFile: vi.fn().mockReturnValue({ id: 'file-1' }),
  getFilesByTaskId: vi.fn().mockReturnValue([]),
  getAllFiles: vi.fn().mockReturnValue([]),
  getFilesGroupedByTask: vi.fn().mockReturnValue({}),
  toggleFileFavorite: vi.fn().mockReturnValue({ id: 'file-1', favorite: true }),
  deleteFile: vi.fn().mockReturnValue(true),

  // Media versions
  createMediaVersion: vi.fn(),
  getMediaVersionsByTaskId: vi.fn().mockReturnValue([]),
  deleteMediaVersionsByTaskId: vi.fn().mockReturnValue(0),

  // Settings
  getSetting: vi
    .fn()
    .mockImplementation((key: string) =>
      key === 'theme' ? 'dark' : undefined,
    ),
  saveSetting: vi.fn(),
  getAllSettings: vi.fn().mockReturnValue({ theme: 'dark' }),
  clearSettings: vi.fn(),

  // Activity
  getActivities: vi.fn().mockReturnValue([]),
  getActivity: vi.fn(),
  getActivityEvents: vi.fn().mockReturnValue([]),
  getActivityEvent: vi.fn(),

  // Dashboard
  getDashboardStats: vi.fn().mockReturnValue({
    totalTasks: 10,
    completedTasks: 5,
    runningTasks: 2,
  }),
  getTaskFlowData: vi.fn().mockReturnValue([]),
  getCostSummary: vi.fn().mockReturnValue({ total: 1.23 }),
  getTaskUsageSummary: vi.fn().mockReturnValue({ tokens: 1000 }),

  // Projects
  createProject: vi.fn().mockReturnValue(mockProject),
  getProjects: vi.fn().mockReturnValue([mockProject]),
  getAllProjects: vi.fn().mockReturnValue([mockProject]),
  getProjectById: vi
    .fn()
    .mockImplementation((id: string) =>
      id === 'proj-1' ? { ...mockProject, taskSummary: {} } : undefined,
    ),
  getProjectWithTaskSummary: vi
    .fn()
    .mockImplementation((id: string) =>
      id === 'proj-1' ? { ...mockProject, taskSummary: {} } : undefined,
    ),
  updateProject: vi.fn().mockReturnValue(mockProject),
  archiveProject: vi.fn().mockReturnValue(mockProject),
  getProjectsForSidebar: vi.fn().mockReturnValue([]),

  // Agent Profiles
  createAgentProfile: vi.fn().mockReturnValue(mockProfile),
  getAgentProfiles: vi.fn().mockReturnValue([mockProfile]),
  getAllAgentProfiles: vi.fn().mockReturnValue([mockProfile]),
  getTaskCountsForProfiles: vi.fn().mockReturnValue({}),
  getAgentProfile: vi
    .fn()
    .mockImplementation((id: string) =>
      id === 'prof-1' ? mockProfile : undefined,
    ),
  updateAgentProfile: vi.fn().mockReturnValue(mockProfile),
  deleteAgentProfile: vi.fn().mockReturnValue(true),
  assignTaskToProfile: vi.fn(),
  getRunningTasksForProfile: vi.fn().mockReturnValue([]),
  getTasksByProfile: vi.fn().mockReturnValue([]),

  // Task hierarchy
  getChildTasks: vi.fn().mockReturnValue([]),
  getTaskLinks: vi.fn().mockReturnValue([]),
  createTaskLink: vi.fn().mockReturnValue({ id: 'link-1' }),
  deleteTaskLink: vi.fn().mockReturnValue(true),
  getTaskComments: vi.fn().mockReturnValue([]),
  createTaskComment: vi.fn().mockReturnValue({ id: 'comment-1' }),
  deleteTaskComment: vi.fn().mockReturnValue(true),

  // Goals
  getGoals: vi.fn().mockReturnValue([]),
  getAllGoals: vi.fn().mockReturnValue([]),
  createGoal: vi.fn().mockReturnValue({ id: 'goal-1' }),
  getGoal: vi.fn(),
  updateGoal: vi.fn(),

  // Templates
  getUserTemplates: vi.fn().mockReturnValue([]),
  createUserTemplate: vi.fn().mockReturnValue({ id: 'tpl-1' }),
  updateUserTemplate: vi.fn(),
  deleteUserTemplate: vi.fn().mockReturnValue(true),
  getUserTemplate: vi.fn(),
}));

vi.mock('@/shared/services/active-query-store', () => ({
  activeQueryStore: {
    getQuery: vi.fn(),
    getSessionId: vi.fn(),
  },
}));

vi.mock('@/shared/services/agent', () => ({
  deleteSession: vi.fn(),
}));

vi.mock('@/shared/services/task-event-bus', () => ({
  taskEventBus: {
    publish: vi.fn(),
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/** All requests must include Host: localhost to pass the localhost guard */
function makeReq(method: string, path: string, body?: unknown): Request {
  const headers: Record<string, string> = { Host: 'localhost' };
  if (body != null) headers['Content-Type'] = 'application/json';
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

const jsonReq = (path: string, body: unknown, method = 'POST') =>
  makeReq(method, path, body);
const getReq = (path: string) => makeReq('GET', path);
const deleteReq = (path: string) => makeReq('DELETE', path);

describe('DB API', () => {
  // ---- TASKS ----

  describe('Tasks', () => {
    it('POST /tasks creates a task', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        jsonReq('/tasks', {
          id: 'task-new',
          session_id: 'session-1',
          task_index: 0,
          prompt: 'Do something',
        }),
      );
      expect(res.status).toBe(201);
    });

    it('GET /tasks returns task list', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/tasks'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('GET /tasks/:id returns single task', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/tasks/task-1'));
      expect(res.status).toBe(200);
    });

    it('GET /tasks/:id returns 404 for unknown', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/tasks/task-unknown'));
      expect(res.status).toBe(404);
    });

    it('PATCH /tasks/:id updates task', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        jsonReq('/tasks/task-1', { title: 'Updated Title' }, 'PATCH'),
      );
      expect(res.status).toBe(200);
    });

    it('DELETE /tasks/:id deletes task', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(deleteReq('/tasks/task-1'));
      expect(res.status).toBe(200);
    });

    it('POST /tasks/batch-delete removes multiple tasks', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        jsonReq('/tasks/batch-delete', { ids: ['task-1', 'task-2'] }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('deleted');
    });

    it('GET /tasks/search returns search results', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/tasks/search?q=test'));
      expect(res.status).toBe(200);
    });

    it('GET /tasks?project_id=x filters by project', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/tasks?project_id=proj-1'));
      expect(res.status).toBe(200);
    });
  });

  // ---- SESSIONS ----

  describe('Sessions', () => {
    it('POST /sessions creates session', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        jsonReq('/sessions', { id: 'session-new', prompt: 'Hello' }),
      );
      expect(res.status).toBe(201);
    });

    it('GET /sessions returns all sessions', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/sessions'));
      expect(res.status).toBe(200);
    });

    it('GET /sessions/:id returns session or 404', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/sessions/session-1'));
      expect(res.status).toBe(200);
    });
  });

  // ---- MESSAGES ----

  describe('Messages', () => {
    it('POST /messages creates message', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        jsonReq('/messages', {
          task_id: 'task-1',
          role: 'user',
          type: 'text',
          content: 'Hello',
        }),
      );
      expect(res.status).toBe(201);
    });

    it('GET /tasks/:taskId/messages returns messages', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/tasks/task-1/messages'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('DELETE /tasks/:taskId/messages/after/:messageId trims retry tail', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const db = await import('@/shared/db/operations');
      const res = await dbRoutes.request(
        deleteReq('/tasks/task-1/messages/after/12'),
      );
      expect(res.status).toBe(200);
      expect(db.deleteMessagesAfter).toHaveBeenCalledWith('task-1', 12);
      await expect(res.json()).resolves.toEqual({ deleted: 2 });
    });
  });

  // ---- AGENT PROFILES ----

  describe('Agent Profiles', () => {
    it('POST /agent-profiles creates profile', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        jsonReq('/agent-profiles', {
          id: 'prof-new',
          name: 'New Agent',
          runtime_id: 'claude',
        }),
      );
      expect(res.status).toBe(201);
    });

    it('GET /agent-profiles returns profiles', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/agent-profiles'));
      expect(res.status).toBe(200);
    });

    it('GET /agent-profiles/:id returns profile or 404', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/agent-profiles/prof-1'));
      expect(res.status).toBe(200);
    });

    it('GET /agent-profiles?status=active filters by status', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        getReq('/agent-profiles?status=active'),
      );
      expect(res.status).toBe(200);
    });

    it('PUT /agent-profiles/:id updates profile', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        jsonReq('/agent-profiles/prof-1', { name: 'Updated Agent' }, 'PUT'),
      );
      expect(res.status).toBe(200);
    });

    it('DELETE /agent-profiles/:id deletes profile', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(deleteReq('/agent-profiles/prof-1'));
      expect(res.status).toBe(200);
    });
  });

  // ---- PROJECTS ----

  describe('Projects', () => {
    it('POST /projects creates project', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        jsonReq('/projects', { id: 'proj-new', name: 'New Project' }),
      );
      expect(res.status).toBe(201);
    });

    it('GET /projects returns project list', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/projects'));
      expect(res.status).toBe(200);
    });

    it('GET /projects/:id returns project detail', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/projects/proj-1'));
      expect(res.status).toBe(200);
    });

    it('GET /projects/:id returns 404 for unknown', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/projects/proj-unknown'));
      expect(res.status).toBe(404);
    });

    it('DELETE /projects/:id archives project', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(deleteReq('/projects/proj-1'));
      expect(res.status).toBe(200);
    });
  });

  // ---- DASHBOARD ----

  describe('Dashboard', () => {
    it('GET /dashboard/stats returns stats', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/dashboard/stats'));
      expect(res.status).toBe(200);
    });

    it('GET /dashboard/task-flow returns chart data', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/dashboard/task-flow?days=7'));
      expect(res.status).toBe(200);
    });

    it('GET /dashboard/cost-summary returns cost data', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        getReq('/dashboard/cost-summary?days=30'),
      );
      expect(res.status).toBe(200);
    });
  });

  // ---- SETTINGS ----

  describe('Settings', () => {
    it('GET /settings returns all settings', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/settings'));
      expect(res.status).toBe(200);
    });

    it('GET /settings/:key returns setting value', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/settings/theme'));
      expect(res.status).toBe(200);
    });

    it('POST /settings/:key saves setting', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(
        jsonReq('/settings/theme', { value: 'light' }),
      );
      expect(res.status).toBe(200);
    });
  });

  // ---- ACTIVITY ----

  describe('Activity', () => {
    it('GET /activity returns activity feed', async () => {
      const { dbRoutes } = await import('@/app/api/db');
      const res = await dbRoutes.request(getReq('/activity?limit=10'));
      expect(res.status).toBe(200);
    });
  });
});
