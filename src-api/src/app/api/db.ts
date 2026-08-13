/**
 * Database API Routes
 *
 * RESTful API endpoints for database operations.
 * Provides unified data access for both browser and desktop modes.
 *
 * Security: These routes are protected by a localhost-only middleware
 * to prevent unauthorized access from external networks.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import * as db from '@/shared/db/operations';
import {
  BatchDeleteSchema,
  CreateAgentProfileSchema,
  CreateFileSchema,
  CreateGoalSchema,
  CreateMessageSchema,
  CreateProjectSchema,
  CreateSessionSchema,
  CreateTaskCommentSchema,
  CreateTaskLinkSchema,
  CreateTaskSchema,
  CreateUserTemplateSchema,
  MediaVersionSchema,
  SaveSettingSchema,
  SearchQuerySchema,
  UpdateAgentProfileSchema,
  UpdateGoalSchema,
  UpdateMessageContentSchema,
  UpdateProjectSchema,
  UpdateSessionTaskCountSchema,
  UpdateTaskFromMessageSchema,
  UpdateTaskSchema,
  UpdateUserTemplateSchema,
} from '@/shared/db/schemas';
import { activeQueryStore } from '@/shared/services/active-query-store';
import { deleteSession } from '@/shared/services/agent';
import {
  BackupV1ServerSchema,
  importBackup,
} from '@/shared/services/backup-import';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DB-API');
const VALID_PROFILE_STATUSES = new Set(['active', 'paused', 'archived']);

const dbRoutes = new Hono();

const DeleteMessagesAfterParamSchema = z.object({
  taskId: z.string().min(1),
  messageId: z.coerce.number().int().positive(),
});

/**
 * Stop any running agent for a task and clean up associated resources.
 * Called before deleting a task to ensure the agent is stopped immediately.
 */
function stopAgentForTask(taskId: string): void {
  const sessionId = activeQueryStore.getSessionId(taskId);
  if (sessionId) {
    try {
      deleteSession(sessionId);
      logger.info(
        `Stopped agent session ${sessionId} for deleted task ${taskId}`,
      );
    } catch (err) {
      logger.warn(`Failed to stop agent session ${sessionId}: ${err}`);
    }
    taskEventBus.publish(taskId, { type: 'done' });
  }
}

// ============ Localhost-Only Guard ============

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Defense-in-depth: The Host header can be spoofed by any HTTP client, so this
 * guard alone is NOT sufficient for security. The server must also bind to
 * 127.0.0.1 (not 0.0.0.0) to prevent external network access. See the listen
 * call in src-api/src/index.ts for the binding configuration.
 */
dbRoutes.use('*', async (c, next) => {
  const host = c.req.header('host') ?? '';
  const hostname = host.split(':')[0] ?? '';

  if (!LOCALHOST_HOSTS.has(hostname)) {
    logger.warn(`Rejected non-localhost request from host: ${host}`);
    return c.json({ error: 'Forbidden: localhost only' }, 403);
  }
  await next();
});

// ============ Error Helper ============

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// ============ Session Routes ============

dbRoutes.post('/sessions', zValidator('json', CreateSessionSchema), (c) => {
  try {
    const input = c.req.valid('json');
    const session = db.createSession(input);
    return c.json(session, 201);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to create session:', detail);
    return c.json({ error: 'Failed to create session', detail }, 500);
  }
});

dbRoutes.get('/sessions/:id', (c) => {
  try {
    const { id } = c.req.param();
    const session = db.getSession(id);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json(session);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get session:', detail);
    return c.json({ error: 'Failed to get session', detail }, 500);
  }
});

dbRoutes.get('/sessions', (c) => {
  try {
    const sessions = db.getAllSessions();
    return c.json(sessions);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get sessions:', detail);
    return c.json({ error: 'Failed to get sessions', detail }, 500);
  }
});

dbRoutes.patch(
  '/sessions/:id/task-count',
  zValidator('json', UpdateSessionTaskCountSchema),
  (c) => {
    try {
      const { id } = c.req.param();
      const { taskCount } = c.req.valid('json');
      db.updateSessionTaskCount(id, taskCount);
      return c.json({ success: true });
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to update session task count:', detail);
      return c.json(
        { error: 'Failed to update session task count', detail },
        500,
      );
    }
  },
);

dbRoutes.get('/sessions/:id/tasks', (c) => {
  try {
    const { id } = c.req.param();
    const tasks = db.getTasksBySessionId(id);
    return c.json(tasks);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get tasks by session:', detail);
    return c.json({ error: 'Failed to get tasks by session', detail }, 500);
  }
});

// ============ Task Routes ============

dbRoutes.post('/tasks', zValidator('json', CreateTaskSchema), (c) => {
  try {
    const input = c.req.valid('json');
    const task = db.createTask(input);
    return c.json(task, 201);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to create task:', detail);
    return c.json({ error: 'Failed to create task', detail }, 500);
  }
});

dbRoutes.get('/tasks/search', zValidator('query', SearchQuerySchema), (c) => {
  try {
    const { q, limit } = c.req.valid('query');
    const tasks = db.searchTasks(q, limit);
    return c.json(tasks);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to search tasks:', detail);
    return c.json({ error: 'Failed to search tasks', detail }, 500);
  }
});

dbRoutes.get('/tasks/:id', (c) => {
  try {
    const { id } = c.req.param();
    const task = db.getTask(id);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }
    return c.json(task);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get task:', detail);
    return c.json({ error: 'Failed to get task', detail }, 500);
  }
});

dbRoutes.get('/tasks', (c) => {
  try {
    const projectId = c.req.query('project_id');
    const unassigned = c.req.query('unassigned');
    const tasks = db.getAllTasks({
      projectId: projectId || undefined,
      unassigned: unassigned === 'true',
    });
    return c.json(tasks);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get tasks:', detail);
    return c.json({ error: 'Failed to get tasks', detail }, 500);
  }
});

dbRoutes.patch('/tasks/:id', zValidator('json', UpdateTaskSchema), (c) => {
  try {
    const { id } = c.req.param();
    const input = c.req.valid('json');
    const task = db.updateTask(id, input);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }
    return c.json(task);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to update task:', detail);
    return c.json({ error: 'Failed to update task', detail }, 500);
  }
});

dbRoutes.delete('/tasks/:id', (c) => {
  try {
    const { id } = c.req.param();
    // Stop any running agent before deleting the task
    stopAgentForTask(id);
    const success = db.deleteTask(id);
    if (!success) {
      return c.json({ error: 'Task not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to delete task:', detail);
    return c.json({ error: 'Failed to delete task', detail }, 500);
  }
});

// Batch delete multiple tasks at once
dbRoutes.post(
  '/tasks/batch-delete',
  zValidator('json', BatchDeleteSchema),
  async (c) => {
    try {
      const { ids } = c.req.valid('json');

      let deletedCount = 0;
      for (const id of ids) {
        // Stop any running agent before deleting
        stopAgentForTask(id);
        if (db.deleteTask(id)) {
          deletedCount++;
        }
      }

      return c.json({ success: true, deleted: deletedCount });
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to batch delete tasks:', detail);
      return c.json({ error: 'Failed to batch delete tasks', detail }, 500);
    }
  },
);

// ============ Message Routes ============

dbRoutes.post('/messages', zValidator('json', CreateMessageSchema), (c) => {
  try {
    const input = c.req.valid('json');
    const message = db.createMessage(input);
    return c.json(message, 201);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to create message:', detail);
    return c.json({ error: 'Failed to create message', detail }, 500);
  }
});

dbRoutes.get('/tasks/:taskId/messages', (c) => {
  try {
    const { taskId } = c.req.param();
    const messages = db.getMessagesByTaskId(taskId);
    return c.json(messages);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get messages:', detail);
    return c.json({ error: 'Failed to get messages', detail }, 500);
  }
});

dbRoutes.delete('/tasks/:taskId/messages', (c) => {
  try {
    const { taskId } = c.req.param();
    const count = db.deleteMessagesByTaskId(taskId);
    return c.json({ deleted: count });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to delete messages:', detail);
    return c.json({ error: 'Failed to delete messages', detail }, 500);
  }
});

dbRoutes.delete(
  '/tasks/:taskId/messages/after/:messageId',
  zValidator('param', DeleteMessagesAfterParamSchema),
  (c) => {
    try {
      const { taskId, messageId } = c.req.valid('param');
      const count = db.deleteMessagesAfter(taskId, messageId);
      return c.json({ deleted: count });
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to delete messages after point:', detail);
      return c.json(
        { error: 'Failed to delete messages after point', detail },
        500,
      );
    }
  },
);

dbRoutes.patch(
  '/messages/:messageId/content',
  zValidator('json', UpdateMessageContentSchema),
  (c) => {
    try {
      const { messageId } = c.req.param();
      const { content } = c.req.valid('json');
      const updated = db.updateMessageContent(messageId, content);
      if (!updated) {
        return c.json({ error: 'Message not found' }, 404);
      }
      return c.json({ success: true });
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to update message content:', detail);
      return c.json({ error: 'Failed to update message content', detail }, 500);
    }
  },
);

dbRoutes.post(
  '/tasks/:taskId/update-from-message',
  zValidator('json', UpdateTaskFromMessageSchema),
  (c) => {
    try {
      const { taskId } = c.req.param();
      const { messageType, subtype, cost, duration } = c.req.valid('json');
      db.updateTaskFromMessage(taskId, messageType, subtype, cost, duration);
      return c.json({ success: true });
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to update task from message:', detail);
      return c.json(
        { error: 'Failed to update task from message', detail },
        500,
      );
    }
  },
);

// ============ File Routes ============

dbRoutes.post('/files', zValidator('json', CreateFileSchema), (c) => {
  try {
    const input = c.req.valid('json');
    const file = db.createFile(input);
    return c.json(file, 201);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to create file:', detail);
    return c.json({ error: 'Failed to create file', detail }, 500);
  }
});

dbRoutes.get('/tasks/:taskId/files', (c) => {
  try {
    const { taskId } = c.req.param();
    const files = db.getFilesByTaskId(taskId);
    return c.json(files);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get files:', detail);
    return c.json({ error: 'Failed to get files', detail }, 500);
  }
});

dbRoutes.get('/files', (c) => {
  try {
    const files = db.getAllFiles();
    return c.json(files);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get all files:', detail);
    return c.json({ error: 'Failed to get all files', detail }, 500);
  }
});

dbRoutes.get('/files/grouped', (c) => {
  try {
    const grouped = db.getFilesGroupedByTask();
    return c.json(grouped);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get grouped files:', detail);
    return c.json({ error: 'Failed to get grouped files', detail }, 500);
  }
});

dbRoutes.patch('/files/:id/favorite', (c) => {
  try {
    const { id } = c.req.param();
    const file = db.toggleFileFavorite(Number(id));
    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }
    return c.json(file);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to toggle file favorite:', detail);
    return c.json({ error: 'Failed to toggle file favorite', detail }, 500);
  }
});

dbRoutes.delete('/files/:id', (c) => {
  try {
    const { id } = c.req.param();
    const success = db.deleteFile(Number(id));
    if (!success) {
      return c.json({ error: 'File not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to delete file:', detail);
    return c.json({ error: 'Failed to delete file', detail }, 500);
  }
});

// ============ Media Version Routes ============

dbRoutes.post(
  '/media-versions',
  zValidator('json', MediaVersionSchema),
  (c) => {
    try {
      const version = c.req.valid('json');
      db.saveMediaVersion(version);
      return c.json({ success: true }, 201);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to save media version:', detail);
      return c.json({ error: 'Failed to save media version', detail }, 500);
    }
  },
);

dbRoutes.get('/tasks/:taskId/media-versions', (c) => {
  try {
    const { taskId } = c.req.param();
    const versions = db.getMediaVersionsByTaskId(taskId);
    return c.json(versions);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get media versions:', detail);
    return c.json({ error: 'Failed to get media versions', detail }, 500);
  }
});

dbRoutes.delete('/tasks/:taskId/media-versions', (c) => {
  try {
    const { taskId } = c.req.param();
    const count = db.deleteMediaVersionsByTaskId(taskId);
    return c.json({ deleted: count });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to delete media versions:', detail);
    return c.json({ error: 'Failed to delete media versions', detail }, 500);
  }
});

// ============ Settings Routes ============

dbRoutes.get('/settings/:key', (c) => {
  try {
    const { key } = c.req.param();
    const value = db.getSetting(key);
    if (value === null) {
      return c.json({ error: 'Setting not found' }, 404);
    }
    return c.json({ key, value });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get setting:', detail);
    return c.json({ error: 'Failed to get setting', detail }, 500);
  }
});

dbRoutes.post('/settings/:key', zValidator('json', SaveSettingSchema), (c) => {
  try {
    const { key } = c.req.param();
    const { value } = c.req.valid('json');
    db.saveSetting(key, value);
    return c.json({ success: true });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to save setting:', detail);
    return c.json({ error: 'Failed to save setting', detail }, 500);
  }
});

dbRoutes.get('/settings', (c) => {
  try {
    const settings = db.getAllSettings();
    return c.json(settings);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get all settings:', detail);
    return c.json({ error: 'Failed to get all settings', detail }, 500);
  }
});

dbRoutes.delete('/settings', (c) => {
  try {
    db.clearAllSettings();
    return c.json({ success: true });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to clear settings:', detail);
    return c.json({ error: 'Failed to clear settings', detail }, 500);
  }
});

// ============ Activity Event Routes ============

const ActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  entity_type: z.string().max(50).optional(),
  entity_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  actor_type: z.enum(['user', 'system', 'agent']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

dbRoutes.get('/activity', zValidator('query', ActivityQuerySchema), (c) => {
  try {
    const query = c.req.valid('query');
    const options = {
      limit: query.limit,
      offset: query.offset,
      entity_type: query.entity_type,
      entity_id: query.entity_id,
      project_id: query.project_id,
      actor_type: query.actor_type,
      from: query.from,
      to: query.to,
    };
    const events = db.getActivityEvents(options);
    return c.json(events);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get activity events:', detail);
    return c.json({ error: 'Failed to get activity events', detail }, 500);
  }
});

dbRoutes.get('/activity/:id', (c) => {
  try {
    const { id } = c.req.param();
    const event = db.getActivityEvent(id);
    if (!event) {
      return c.json({ error: 'Activity event not found' }, 404);
    }
    return c.json(event);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get activity event:', detail);
    return c.json({ error: 'Failed to get activity event', detail }, 500);
  }
});

// ============ Dashboard Routes ============

dbRoutes.get('/dashboard/stats', (c) => {
  try {
    const stats = db.getDashboardStats();
    return c.json(stats);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get dashboard stats:', detail);
    return c.json({ error: 'Failed to get dashboard stats', detail }, 500);
  }
});

dbRoutes.get('/dashboard/task-flow', (c) => {
  try {
    const rawDays = c.req.query('days') ? Number(c.req.query('days')) : 7;
    const days = Number.isFinite(rawDays)
      ? Math.max(1, Math.min(rawDays, 365))
      : 7;
    const data = db.getTaskFlowData(days);
    return c.json(data);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get task flow data:', detail);
    return c.json({ error: 'Failed to get task flow data', detail }, 500);
  }
});

dbRoutes.get('/dashboard/cost-summary', (c) => {
  try {
    const rawDays = c.req.query('days') ? Number(c.req.query('days')) : 30;
    const days = Number.isFinite(rawDays)
      ? Math.max(1, Math.min(rawDays, 365))
      : 30;
    const data = db.getCostSummary(days);
    return c.json(data);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get cost summary:', detail);
    return c.json({ error: 'Failed to get cost summary', detail }, 500);
  }
});

// ============ Task Usage Route ============

dbRoutes.get('/tasks/:id/usage', (c) => {
  try {
    const { id } = c.req.param();
    const usage = db.getTaskUsageSummary(id);
    return c.json(usage);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get task usage:', detail);
    return c.json({ error: 'Failed to get task usage', detail }, 500);
  }
});

// ============ Task Hierarchy Routes ============

dbRoutes.get('/tasks/:id/children', (c) => {
  try {
    const { id } = c.req.param();
    const children = db.getChildTasks(id);
    return c.json(children);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get child tasks:', detail);
    return c.json({ error: 'Failed to get child tasks', detail }, 500);
  }
});

dbRoutes.get('/tasks/:id/links', (c) => {
  try {
    const { id } = c.req.param();
    const links = db.getTaskLinks(id);
    return c.json(links);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get task links:', detail);
    return c.json({ error: 'Failed to get task links', detail }, 500);
  }
});

dbRoutes.post(
  '/tasks/:id/links',
  zValidator('json', CreateTaskLinkSchema),
  (c) => {
    try {
      const input = c.req.valid('json');
      const link = db.createTaskLink(input);
      return c.json(link, 201);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to create task link:', detail);
      return c.json({ error: 'Failed to create task link', detail }, 500);
    }
  },
);

dbRoutes.delete('/task-links/:id', (c) => {
  try {
    const { id } = c.req.param();
    const success = db.deleteTaskLink(id);
    if (!success) {
      return c.json({ error: 'Task link not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to delete task link:', detail);
    return c.json({ error: 'Failed to delete task link', detail }, 500);
  }
});

dbRoutes.get('/tasks/:id/comments', (c) => {
  try {
    const { id } = c.req.param();
    const comments = db.getTaskComments(id);
    return c.json(comments);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get task comments:', detail);
    return c.json({ error: 'Failed to get task comments', detail }, 500);
  }
});

dbRoutes.post(
  '/tasks/:id/comments',
  zValidator('json', CreateTaskCommentSchema),
  (c) => {
    try {
      const input = c.req.valid('json');
      const comment = db.createTaskComment(input);
      return c.json(comment, 201);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to create task comment:', detail);
      return c.json({ error: 'Failed to create task comment', detail }, 500);
    }
  },
);

dbRoutes.delete('/task-comments/:id', (c) => {
  try {
    const { id } = c.req.param();
    const success = db.deleteTaskComment(id);
    if (!success) {
      return c.json({ error: 'Task comment not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to delete task comment:', detail);
    return c.json({ error: 'Failed to delete task comment', detail }, 500);
  }
});

// ============ Project Routes ============

dbRoutes.get('/projects/sidebar', (c) => {
  try {
    const data = db.getProjectsWithRecentTasks(5);
    return c.json(data);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get sidebar projects:', detail);
    return c.json({ error: 'Failed to get sidebar projects', detail }, 500);
  }
});

dbRoutes.get('/projects', (c) => {
  try {
    const status = c.req.query('status');
    const projects = db.getAllProjects(status);
    return c.json(projects);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get projects:', detail);
    return c.json({ error: 'Failed to get projects', detail }, 500);
  }
});

dbRoutes.post('/projects', zValidator('json', CreateProjectSchema), (c) => {
  try {
    const input = c.req.valid('json');
    const project = db.createProject(input);
    return c.json(project, 201);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to create project:', detail);
    return c.json({ error: 'Failed to create project', detail }, 500);
  }
});

dbRoutes.get('/projects/:id', (c) => {
  try {
    const { id } = c.req.param();
    const project = db.getProjectWithTaskSummary(id);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    return c.json(project);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get project:', detail);
    return c.json({ error: 'Failed to get project', detail }, 500);
  }
});

dbRoutes.patch(
  '/projects/:id',
  zValidator('json', UpdateProjectSchema),
  (c) => {
    try {
      const { id } = c.req.param();
      const input = c.req.valid('json');
      const project = db.updateProject(id, input);
      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }
      return c.json(project);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to update project:', detail);
      return c.json({ error: 'Failed to update project', detail }, 500);
    }
  },
);

dbRoutes.delete('/projects/:id', (c) => {
  try {
    const { id } = c.req.param();
    const project = db.archiveProject(id);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    return c.json(project);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to archive project:', detail);
    return c.json({ error: 'Failed to archive project', detail }, 500);
  }
});

// ============ Goal Routes ============

dbRoutes.get('/goals', (c) => {
  try {
    const projectId = c.req.query('project_id');
    const goals = db.getAllGoals(projectId);
    return c.json(goals);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get goals:', detail);
    return c.json({ error: 'Failed to get goals', detail }, 500);
  }
});

dbRoutes.post('/goals', zValidator('json', CreateGoalSchema), (c) => {
  try {
    const input = c.req.valid('json');
    const goal = db.createGoal(input);
    return c.json(goal, 201);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to create goal:', detail);
    return c.json({ error: 'Failed to create goal', detail }, 500);
  }
});

dbRoutes.get('/goals/:id', (c) => {
  try {
    const { id } = c.req.param();
    const goal = db.getGoal(id);
    if (!goal) {
      return c.json({ error: 'Goal not found' }, 404);
    }
    return c.json(goal);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get goal:', detail);
    return c.json({ error: 'Failed to get goal', detail }, 500);
  }
});

dbRoutes.patch('/goals/:id', zValidator('json', UpdateGoalSchema), (c) => {
  try {
    const { id } = c.req.param();
    const input = c.req.valid('json');
    const goal = db.updateGoal(id, input);
    if (!goal) {
      return c.json({ error: 'Goal not found' }, 404);
    }
    return c.json(goal);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to update goal:', detail);
    return c.json({ error: 'Failed to update goal', detail }, 500);
  }
});

// ============================================================================
// Agent Profile Routes
// ============================================================================

dbRoutes.post(
  '/agent-profiles',
  zValidator('json', CreateAgentProfileSchema),
  (c) => {
    try {
      const input = c.req.valid('json');
      const profile = db.createAgentProfile(input);
      return c.json(profile, 201);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to create agent profile:', detail);
      return c.json({ error: 'Failed to create agent profile', detail }, 500);
    }
  },
);

dbRoutes.get('/agent-profiles', (c) => {
  try {
    const rawStatus = c.req.query('status');
    const status =
      rawStatus && VALID_PROFILE_STATUSES.has(rawStatus)
        ? (rawStatus as 'active' | 'paused' | 'archived')
        : undefined;
    const profiles = db.getAllAgentProfiles(status);

    // Enrich with task counts via single aggregation query
    const profileIds = profiles.map((p) => p.id);
    const taskCounts = db.getTaskCountsForProfiles(profileIds);
    const enriched = profiles.map((profile) => ({
      ...profile,
      task_count: taskCounts[profile.id] ?? 0,
    }));

    return c.json(enriched);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to list agent profiles:', detail);
    return c.json({ error: 'Failed to list profiles', detail }, 500);
  }
});

dbRoutes.get('/agent-profiles/:id', (c) => {
  try {
    const profile = db.getAgentProfile(c.req.param('id'));
    if (!profile) return c.json({ error: 'Profile not found' }, 404);
    return c.json(profile);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to get agent profile:', detail);
    return c.json({ error: 'Failed to get profile', detail }, 500);
  }
});

dbRoutes.put(
  '/agent-profiles/:id',
  zValidator('json', UpdateAgentProfileSchema),
  (c) => {
    try {
      const { id } = c.req.param();
      const input = c.req.valid('json');
      const profile = db.updateAgentProfile(id, input);
      return c.json(profile);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to update agent profile:', detail);
      return c.json({ error: 'Failed to update profile', detail }, 500);
    }
  },
);

dbRoutes.delete('/agent-profiles/:id', (c) => {
  try {
    const { id } = c.req.param();
    // Check for running tasks assigned to this profile
    const tasks = db.getTasksByProfile(id);
    const runningTasks = tasks.filter((t) => t.status === 'running');
    if (runningTasks.length > 0) {
      return c.json({ error: 'Cannot delete profile with running tasks' }, 409);
    }
    db.deleteAgentProfile(id);
    return c.json({ success: true });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to delete agent profile:', detail);
    return c.json({ error: 'Failed to delete profile', detail }, 500);
  }
});

const AssignTaskSchema = z.object({ profileId: z.string().min(1) });

dbRoutes.post(
  '/tasks/:taskId/assign',
  zValidator('json', AssignTaskSchema),
  async (c) => {
    try {
      const { taskId } = c.req.param();
      const { profileId } = c.req.valid('json');
      // Verify profile exists and is active
      const profile = db.getAgentProfile(profileId);
      if (!profile) return c.json({ error: 'Profile not found' }, 404);
      if (profile.status !== 'active') {
        return c.json({ error: 'Profile is not active' }, 400);
      }
      const success = db.assignTaskToProfile(taskId, profileId);
      if (!success) {
        return c.json({ error: 'Task assignment conflict' }, 409);
      }
      return c.json({ success: true });
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to assign task:', detail);
      return c.json({ error: 'Failed to assign task', detail }, 500);
    }
  },
);

// ============================================================================
// User Template Routes
// ============================================================================

dbRoutes.get('/templates', (c) => {
  try {
    const category = c.req.query('category');
    const templates = db.getAllUserTemplates(category);
    return c.json(templates);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to list templates:', detail);
    return c.json({ error: 'Failed to list templates', detail }, 500);
  }
});

dbRoutes.post(
  '/templates',
  zValidator('json', CreateUserTemplateSchema),
  (c) => {
    try {
      const input = c.req.valid('json');
      const template = db.createUserTemplate(input);
      return c.json(template, 201);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to create template:', detail);
      return c.json({ error: 'Failed to create template', detail }, 500);
    }
  },
);

dbRoutes.put(
  '/templates/:id',
  zValidator('json', UpdateUserTemplateSchema),
  (c) => {
    try {
      const { id } = c.req.param();
      // Block modification of built-in templates
      const existing = db.getUserTemplate(id);
      if (!existing) return c.json({ error: 'Template not found' }, 404);
      if (existing.is_built_in) {
        return c.json({ error: 'Cannot modify built-in templates' }, 403);
      }
      const input = c.req.valid('json');
      const template = db.updateUserTemplate(id, input);
      return c.json(template);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to update template:', detail);
      return c.json({ error: 'Failed to update template', detail }, 500);
    }
  },
);

dbRoutes.delete('/templates/:id', (c) => {
  try {
    const { id } = c.req.param();
    const existing = db.getUserTemplate(id);
    if (!existing) return c.json({ error: 'Template not found' }, 404);
    if (existing.is_built_in) {
      return c.json({ error: 'Cannot delete built-in templates' }, 403);
    }
    db.deleteUserTemplate(id);
    return c.json({ success: true });
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to delete template:', detail);
    return c.json({ error: 'Failed to delete template', detail }, 500);
  }
});

dbRoutes.post('/templates/:id/export', (c) => {
  try {
    const { id } = c.req.param();
    const template = db.getUserTemplate(id);
    if (!template) return c.json({ error: 'Template not found' }, 404);
    return c.json(template);
  } catch (error) {
    const detail = formatError(error);
    logger.error('Failed to export template:', detail);
    return c.json({ error: 'Failed to export template', detail }, 500);
  }
});

dbRoutes.post(
  '/templates/import',
  zValidator('json', CreateUserTemplateSchema),
  (c) => {
    try {
      const input = c.req.valid('json');
      const template = db.createUserTemplate(input);
      return c.json(template, 201);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to import template:', detail);
      return c.json({ error: 'Failed to import template', detail }, 500);
    }
  },
);

// ============ Backup Import ============

dbRoutes.post(
  '/import-backup',
  zValidator('json', BackupV1ServerSchema),
  (c) => {
    try {
      const payload = c.req.valid('json');
      const result = importBackup(payload);
      if (!result.success) {
        return c.json(result, 400);
      }
      return c.json(result);
    } catch (error) {
      const detail = formatError(error);
      logger.error('Failed to import backup:', detail);
      return c.json({ success: false, error: detail }, 500);
    }
  },
);

export { dbRoutes };
