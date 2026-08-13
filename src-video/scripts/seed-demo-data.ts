const API_URL = 'http://localhost:5126';

type SeedProfile = 'docs.empty' | 'docs.populated' | 'docs.streaming';

interface DemoProject {
  id: string;
  name: string;
  description: string;
  color: string;
  workspace: string;
}

interface DemoTask {
  id: string;
  sessionId: string;
  taskIndex: number;
  prompt: string;
  title: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  projectId?: string;
  messages: Array<{
    type: 'user' | 'text' | 'tool_use' | 'tool_result' | 'result';
    content: string;
  }>;
}

const demoProject: DemoProject = {
  id: 'docs-project-alpha',
  name: 'Acme support workspace',
  description: 'Customer support automation and reporting tasks',
  color: '#6366f1',
  workspace: '~/work/acme-support',
};

const populatedTasks: DemoTask[] = [
  {
    id: 'docs-task-triage',
    sessionId: 'docs-session-projects',
    taskIndex: 0,
    prompt: 'Summarize open support escalations and draft a weekly plan',
    title: 'Summarize open support escalations',
    status: 'completed',
    priority: 'high',
    projectId: demoProject.id,
    messages: [
      {
        type: 'user',
        content: 'Summarize open support escalations and draft a weekly plan.',
      },
      {
        type: 'text',
        content:
          'I grouped the escalations by customer impact, identified the owners, and drafted the weekly support plan.',
      },
    ],
  },
  {
    id: 'docs-task-reporting',
    sessionId: 'docs-session-projects',
    taskIndex: 1,
    prompt: 'Create a dashboard for support volume by customer segment',
    title: 'Create support volume dashboard',
    status: 'running',
    priority: 'medium',
    projectId: demoProject.id,
    messages: [
      {
        type: 'user',
        content: 'Create a dashboard for support volume by customer segment.',
      },
      {
        type: 'text',
        content:
          'I am pulling the last 30 days of support data and preparing segment-level charts.',
      },
    ],
  },
  {
    id: 'docs-task-unassigned',
    sessionId: 'docs-session-backlog',
    taskIndex: 0,
    prompt: 'Research renewal risks for enterprise customers',
    title: 'Research enterprise renewal risks',
    status: 'completed',
    priority: 'low',
    messages: [
      {
        type: 'user',
        content: 'Research renewal risks for enterprise customers.',
      },
      {
        type: 'text',
        content:
          'The highest-risk renewals are concentrated in accounts with unresolved integration blockers.',
      },
    ],
  },
];

const streamingTask: DemoTask = {
  id: 'docs-task-streaming',
  sessionId: 'docs-session-streaming',
  taskIndex: 0,
  prompt: 'Plan a customer onboarding automation',
  title: 'Plan customer onboarding automation',
  status: 'running',
  priority: 'high',
  projectId: demoProject.id,
  messages: [
    {
      type: 'user',
      content: 'Plan a customer onboarding automation.',
    },
    {
      type: 'text',
      content:
        'I am drafting the onboarding workflow, checking required integrations, and preparing approval checkpoints.',
    },
  ],
};

function parseProfile(): SeedProfile {
  const profileArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith('--profile='));
  const profile = profileArg?.slice('--profile='.length) ?? 'docs.populated';

  if (
    profile === 'docs.empty' ||
    profile === 'docs.populated' ||
    profile === 'docs.streaming'
  ) {
    return profile;
  }

  throw new Error(
    `Unknown profile: ${profile}. Use docs.empty, docs.populated, or docs.streaming.`,
  );
}

async function request(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

async function checkApi() {
  try {
    const health = await fetch(`${API_URL}/health`);
    if (!health.ok) {
      throw new Error(`API returned ${health.status}`);
    }
  } catch {
    throw new Error(`API server not reachable at ${API_URL}`);
  }
}

async function ensureSession(id: string, prompt: string) {
  const existing = await request(`/db/sessions/${id}`);
  if (existing.ok) return;

  const created = await request('/db/sessions', {
    method: 'POST',
    body: JSON.stringify({ id, prompt }),
  });
  if (!created.ok) {
    throw new Error(`Failed to create session ${id}: ${created.status}`);
  }
}

async function ensureProject(project: DemoProject) {
  const existing = await request(`/db/projects/${project.id}`);
  if (existing.ok) {
    await request(`/db/projects/${project.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: project.name,
        description: project.description,
        color: project.color,
        workspace: project.workspace,
        status: 'active',
      }),
    });
    return;
  }

  const created = await request('/db/projects', {
    method: 'POST',
    body: JSON.stringify(project),
  });
  if (!created.ok) {
    throw new Error(
      `Failed to create project ${project.id}: ${created.status}`,
    );
  }
}

async function deleteKnownTasks() {
  const ids = [...populatedTasks.map((task) => task.id), streamingTask.id];
  await request('/db/tasks/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

async function seedTask(task: DemoTask) {
  await ensureSession(task.sessionId, task.prompt);

  const created = await request('/db/tasks', {
    method: 'POST',
    body: JSON.stringify({
      id: task.id,
      session_id: task.sessionId,
      task_index: task.taskIndex,
      prompt: task.prompt,
      work_dir: '~/work/acme-support',
      project_id: task.projectId ?? null,
    }),
  });

  if (!created.ok) {
    throw new Error(`Failed to create task ${task.id}: ${created.status}`);
  }

  await request(`/db/tasks/${task.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: task.status,
      title: task.title,
      priority: task.priority,
      project_id: task.projectId ?? null,
    }),
  });

  await request(`/db/tasks/${task.id}/messages`, { method: 'DELETE' });

  for (const message of task.messages) {
    await request('/db/messages', {
      method: 'POST',
      body: JSON.stringify({
        task_id: task.id,
        type: message.type,
        content: message.content,
      }),
    });
  }
}

async function resetKnownState() {
  await deleteKnownTasks();
  const existing = await request(`/db/projects/${demoProject.id}`);
  if (existing.ok) {
    await request(`/db/projects/${demoProject.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    });
  }
}

async function seedProfile(profile: SeedProfile) {
  await checkApi();
  await resetKnownState();

  if (profile === 'docs.empty') {
    console.log('Seeded docs.empty profile.');
    return;
  }

  await ensureProject(demoProject);

  const tasks =
    profile === 'docs.streaming'
      ? [...populatedTasks, streamingTask]
      : populatedTasks;

  for (const task of tasks) {
    await seedTask(task);
  }

  console.log(`Seeded ${profile} profile with ${tasks.length} task(s).`);
}

seedProfile(parseProfile()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error('Start the API with: pnpm dev:api');
  process.exit(1);
});
