import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAgentPrompt,
  deriveAttachmentDirs,
  notifyAttachmentFailures,
  resolveAttachmentsForSubmit,
} from '@/components/task/taskV2-submit-helpers';
import { API_BASE_URL } from '@/config';
import { createSession, createTask } from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { useDispatch } from '@/shared/hooks/useDispatch';
import { addBackgroundTask } from '@/shared/lib/background-tasks';

vi.mock('@/components/task/taskV2-submit-helpers', () => ({
  buildAgentPrompt: vi.fn(),
  deriveAttachmentDirs: vi.fn(),
  notifyAttachmentFailures: vi.fn(),
  resolveAttachmentsForSubmit: vi.fn(),
}));
vi.mock('@/shared/db', () => ({ createSession: vi.fn(), createTask: vi.fn() }));
vi.mock('@/shared/hooks/useAgent', () => ({
  buildModelOverride: () => ({ model: 'test-model' }),
}));
vi.mock('@/shared/lib/background-tasks', () => ({
  addBackgroundTask: vi.fn(),
  updateBackgroundTaskStatus: vi.fn(),
}));
vi.mock('@/shared/lib/session', () => ({ generateSessionId: () => 'session' }));
vi.mock('@/shared/utils/uuid', () => ({ randomUUID: () => 'task' }));
vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({ tt: (key: string) => key }),
}));

const attachments: MessageAttachment[] = [
  {
    id: 'video',
    type: 'file',
    name: 'clip.mp4',
    data: '',
    file: new File(['clip'], 'clip.mp4'),
  },
];
const resolved: MessageAttachment[] = [
  {
    id: 'video',
    type: 'file',
    name: 'clip.mp4',
    data: '',
    path: '/media/clip.mp4',
  },
  {
    id: 'image',
    type: 'image',
    name: 'image.png',
    data: 'aW1hZ2U=',
    mimeType: 'image/png',
  },
];
const imageBlocks = [
  { type: 'image' as const, image: 'data:image/png;base64,aW1hZ2U=' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSession).mockImplementation(async (input) => ({
    ...input,
    task_count: 0,
    created_at: '2026-10-05T00:00:00Z',
    updated_at: '2026-10-05T00:00:00Z',
  }));
  vi.mocked(createTask).mockImplementation(async (input) => ({
    ...input,
    status: 'running',
    cost: null,
    duration: null,
    created_at: '2026-10-05T00:00:00Z',
    updated_at: '2026-10-05T00:00:00Z',
  }));
  vi.mocked(resolveAttachmentsForSubmit).mockResolvedValue({
    attachments: resolved,
    failures: [],
  });
  vi.mocked(notifyAttachmentFailures).mockReturnValue(false);
  vi.mocked(buildAgentPrompt).mockReturnValue({
    prompt: 'Read /media/clip.mp4\nInspect attachments',
    imageBlocks,
  });
  vi.mocked(deriveAttachmentDirs).mockReturnValue(['/media', '/secondary']);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
  );
  vi.stubGlobal(
    'EventSource',
    class {
      close = vi.fn();
      onmessage = null;
      onerror = null;
      readyState = 0;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDispatch attachment staging', () => {
  it('returns false and creates no task or request when an attachment fails to stage', async () => {
    const failures = [
      {
        id: 'video',
        name: 'clip.mp4',
        reason: 'too_large' as const,
        limitBytes: 50 * 1024 * 1024,
      },
    ];
    vi.mocked(resolveAttachmentsForSubmit).mockResolvedValue({
      attachments,
      failures,
    });
    vi.mocked(notifyAttachmentFailures).mockReturnValue(true);
    const { result } = renderHook(() =>
      useDispatch({ workDirs: ['/workspace'], selectedModel: 'test-model' }),
    );

    await act(async () => {
      await expect(
        result.current.dispatch('Inspect attachments', attachments),
      ).resolves.toBe(false);
    });

    expect(resolveAttachmentsForSubmit).toHaveBeenCalledWith(
      attachments,
      'task',
      '/workspace',
    );
    expect(notifyAttachmentFailures).toHaveBeenCalledWith(
      failures,
      expect.any(Function),
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(addBackgroundTask).not.toHaveBeenCalled();
    expect(buildAgentPrompt).not.toHaveBeenCalled();
    expect(result.current.isDispatching).toBe(false);
  });

  it('forwards the resolved file prompt, images and deduplicated attachment directories on success', async () => {
    const { result } = renderHook(() =>
      useDispatch({
        workDirs: ['/workspace', '/secondary'],
        selectedModel: 'test-model',
        profileId: 'profile',
        profileMcpServers: ['files'],
        profileSkills: ['research'],
      }),
    );

    await act(async () => {
      await result.current.dispatch(
        '  Inspect attachments  ',
        attachments,
        ['files', 'search'],
        ['research', 'editing'],
      );
    });

    expect(buildAgentPrompt).toHaveBeenCalledWith(
      'Inspect attachments',
      resolved,
    );
    expect(deriveAttachmentDirs).toHaveBeenCalledWith(resolved);
    expect(createSession).toHaveBeenCalledWith({
      id: 'session',
      prompt: 'Inspect attachments',
    });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task',
        prompt: 'Read /media/clip.mp4\nInspect attachments',
        work_dir: '/workspace',
      }),
    );
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/ag-ui/run`);
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    const body = JSON.parse(String(init?.body));
    expect(body.messages).toEqual([
      {
        id: 'task',
        role: 'user',
        content: 'Read /media/clip.mp4\nInspect attachments',
      },
    ]);
    expect(body.forwardedProps).toEqual({
      taskId: 'task',
      workDir: '/workspace',
      additionalWorkDirs: ['/secondary', '/media'],
      images: imageBlocks,
      modelConfig: { model: 'test-model' },
      mcpServers: ['files', 'search'],
      pinnedSkills: ['research', 'editing'],
      assigneeProfileId: 'profile',
      autoApprove: true,
    });
    expect(addBackgroundTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task',
        prompt: 'Read /media/clip.mp4\nInspect attachments',
        isRunning: true,
      }),
    );
    expect(result.current.isDispatching).toBe(false);
  });
});
