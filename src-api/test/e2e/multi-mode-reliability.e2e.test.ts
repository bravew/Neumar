import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getJson, postJson } from '../helpers/http-client';
import {
  spawnApiInstance,
  stopApiInstance,
  type ApiInstance,
} from '../helpers/spawn-api';
import { assertSSEHeaders, collectSSEFromResponse } from '../helpers/stream';

interface RunNode {
  id: string;
  executionId: string;
  status: string;
  children: RunNode[];
}

interface RunTreeResponse {
  tree: RunNode[];
  executions: Array<{
    executionId: string;
    attemptCount: number;
    latestRunId: string;
  }>;
}

describe('multi-mode reliability real-server smoke', () => {
  let api: ApiInstance;

  beforeAll(async () => {
    api = await spawnApiInstance('multi-mode-reliability', {
      env: {
        NEUMA_MOCK_NO_DELAY: '1',
        NEUMA_MOCK_TRACE: 'hello-read-edit',
        NEUMA_VIDEO_AGENTIC_RUNTIME: 'off',
        NEUMA_VIDEO_AGENT_SDK: 'off',
      },
    });
  }, 60_000);

  afterAll(async () => {
    await stopApiInstance(api);
  });

  it('runs Task, Design, and Video turns with durable reconnect and Task recovery', async () => {
    const taskId = `task-${randomUUID()}`;
    const sessionId = `session-${randomUUID()}`;
    const workDir = join(import.meta.dirname, '..');
    expect(
      (
        await postJson(api.baseUrl, '/memory/config', {
          enabled: false,
          autoRecall: false,
          autoCapture: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postJson(api.baseUrl, '/db/sessions', {
          id: sessionId,
          prompt: 'Multi-mode smoke',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await postJson(api.baseUrl, '/db/tasks', {
          id: taskId,
          session_id: sessionId,
          task_index: 0,
          prompt: 'Run the smoke turn',
          work_dir: workDir,
        })
      ).status,
    ).toBe(201);

    await runTaskTurn(api, taskId, workDir);
    const firstTaskTree = await ownerTree(api, 'task', taskId);
    const firstTaskRun = flatten(firstTaskTree.tree)[0];
    expect(firstTaskRun).toMatchObject({ status: 'completed' });
    await expectReplay(api, 'task', taskId, firstTaskRun.id);

    await runTaskTurn(api, taskId, workDir, {
      executionId: firstTaskRun.executionId,
      sourceRunId: firstTaskRun.id,
      action: 'retry',
    });
    const recoveredTaskTree = await ownerTree(api, 'task', taskId);
    expect(recoveredTaskTree.executions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: firstTaskRun.executionId,
          attemptCount: 2,
        }),
      ]),
    );

    const design = await postJson(api.baseUrl, '/design/projects', {
      title: 'Reliability smoke design',
      surface: 'prototype',
      brief: {
        brand: 'Neuma',
        audience: 'release reviewers',
        output: 'single-page prototype',
      },
    });
    expect(design.status).toBe(201);
    const designId = (design.json as { project: { id: string } }).project.id;
    const designResponse = await fetch(
      `${api.baseUrl}/design/projects/${designId}/chat`,
      {
        ...jsonRequest({
          prompt: 'Build the release smoke prototype',
          provider: 'mock',
          model: 'hello-read-edit',
          runContext: runContext('design', designId),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    assertSSEHeaders(designResponse);
    expect(
      await collectSSEWithLabel('Design turn', designResponse),
    ).not.toHaveLength(0);
    const designRun = flatten(
      (await ownerTree(api, 'design', designId)).tree,
    )[0];
    expect(designRun).toMatchObject({ status: 'completed' });
    await expectReplay(api, 'design', designId, designRun.id);

    const video = await postJson(api.baseUrl, '/video/projects', {
      name: 'Reliability smoke video',
      template: 'slideshow',
      prompt: 'A concise launch recap',
    });
    expect(video.status).toBe(201);
    const videoId = (video.json as { project: { id: string } }).project.id;
    const videoResponse = await fetch(
      `${api.baseUrl}/video/projects/${videoId}/agent`,
      {
        ...jsonRequest({
          message: 'Summarize the next edit',
          mode: 'chat',
          runContext: runContext('video', videoId),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    assertSSEHeaders(videoResponse);
    expect(
      await collectSSEWithLabel('Video turn', videoResponse),
    ).not.toHaveLength(0);
    const videoRun = flatten((await ownerTree(api, 'video', videoId)).tree)[0];
    expect(videoRun).toMatchObject({ status: 'completed' });
  }, 60_000);
});

async function runTaskTurn(
  api: ApiInstance,
  taskId: string,
  workDir: string,
  recovery?: {
    executionId: string;
    sourceRunId: string;
    action: 'retry';
  },
) {
  const response = await fetch(`${api.baseUrl}/ag-ui/run`, {
    ...jsonRequest({
      threadId: taskId,
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          content: recovery ? 'Retry the smoke turn' : 'Run the smoke turn',
        },
      ],
      taskId,
      workDir,
      modelConfig: { agentType: 'mock', model: 'hello-read-edit' },
      runContext: {
        ...runContext('task', taskId),
        conversationId: taskId,
        projectId: null,
        recovery,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error(
      `Task turn returned ${response.status}: ${await response.text()}`,
    );
  }
  assertSSEHeaders(response);
  expect(
    await collectSSEWithLabel(
      recovery ? 'Task recovery turn' : 'Task initial turn',
      response,
    ),
  ).not.toHaveLength(0);
}

function runContext(mode: 'task' | 'design' | 'video', ownerKey: string) {
  return {
    mode,
    projectId: mode === 'task' ? null : ownerKey,
    clientRequestId: randomUUID(),
    messageId: randomUUID(),
    supplementalSkillIds: [],
  };
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function ownerTree(
  api: ApiInstance,
  mode: 'task' | 'design' | 'video',
  ownerKey: string,
) {
  const response = await getJson(
    api.baseUrl,
    `/runs/owner/${mode}/${ownerKey}/tree`,
  );
  expect(response.status).toBe(200);
  return response.json as RunTreeResponse;
}

function flatten(nodes: RunNode[]): RunNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function expectReplay(
  api: ApiInstance,
  mode: 'task' | 'design' | 'video',
  ownerKey: string,
  runId: string,
) {
  const response = await fetch(
    `${api.baseUrl}/ag-ui/subscribe/${mode}/${ownerKey}/${runId}`,
    {
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': '0' },
      signal: AbortSignal.timeout(10_000),
    },
  );
  assertSSEHeaders(response);
  const events = await collectSSEWithLabel(`${mode} replay`, response);
  expect(events.some((event) => event.data)).toBe(true);
}

async function collectSSEWithLabel(label: string, response: Response) {
  try {
    return await collectSSEFromResponse(response);
  } catch (error) {
    throw new Error(`${label} failed: ${String(error)}`, { cause: error });
  }
}
