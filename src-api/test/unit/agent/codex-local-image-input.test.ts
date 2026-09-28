import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const startThread = vi.fn();
  const resumeThread = vi.fn();
  const codexConstructor = vi.fn(function Codex() {
    return {
      startThread,
      resumeThread,
    };
  });

  return {
    codexConstructor,
    startThread,
    resumeThread,
    buildSubprocessMcpConfig: vi.fn(),
    logUsage: vi.fn(),
    resolveCodexBinaryPath: vi.fn(() => '/usr/local/bin/codex'),
  };
});

vi.mock('@openai/codex-sdk', () => ({
  Codex: mocks.codexConstructor,
}));

vi.mock('@/config/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/constants')>();
  return {
    ...actual,
    DEFAULT_API_HOST: '127.0.0.1',
    DEFAULT_API_PORT: 2620,
    DEFAULT_WORK_DIR: '/tmp/neuma-codex-local-image-test',
  };
});

vi.mock('@/shared/mcp/subprocess-bridge', () => ({
  buildSubprocessMcpConfig: mocks.buildSubprocessMcpConfig,
}));

vi.mock('@/shared/services/usage-logger', () => ({
  logUsage: mocks.logUsage,
}));

vi.mock('@/shared/utils/codex-binary', () => ({
  getExtendedPath: vi.fn(() => '/usr/local/bin:/usr/bin:/bin'),
  resolveCodexBinaryPath: mocks.resolveCodexBinaryPath,
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { CodexAgent } from '@/extensions/agent/codex';

type CodexUserInputLike =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };

function createBridge() {
  return {
    codexConfig: {},
    denialHints: [],
    env: {},
    revoke: vi.fn(),
  };
}

function eventStream(events: unknown[]) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function createThread(events: unknown[]) {
  return {
    runStreamed: vi.fn(async () => ({
      events: eventStream(events),
    })),
  };
}

// A minimal valid 1x1 PNG, base64-encoded, wrapped as a data URL — exercises
// the data-URL-prefix-stripping branch of saveImagesToDisk.
const ONE_PIXEL_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('CodexAgent local image input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSubprocessMcpConfig.mockResolvedValue(createBridge());
  });

  it('forwards attached images as local_image UserInput items', async () => {
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-img' },
      {
        type: 'item.completed',
        item: { id: 'msg-1', type: 'agent_message', text: 'I see it' },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages = [];
    for await (const message of agent.run('describe this image', {
      taskId: 'task-local-image-1',
      images: [{ data: ONE_PIXEL_PNG_DATA_URL, mimeType: 'image/png' }],
    })) {
      messages.push(message);
    }

    expect(thread.runStreamed).toHaveBeenCalledOnce();
    const input = thread.runStreamed.mock.calls[0]?.[0] as
      | string
      | CodexUserInputLike[];
    expect(Array.isArray(input)).toBe(true);
    const inputItems = input as CodexUserInputLike[];

    const imageItems = inputItems.filter((i) => i.type === 'local_image');
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0]).toMatchObject({ type: 'local_image' });
    if (imageItems[0]?.type === 'local_image') {
      expect(imageItems[0].path).toMatch(/attachments[/\\]image_.*\.png$/);
    }

    const textItem = inputItems.find((i) => i.type === 'text');
    expect(textItem).toBeDefined();
    if (textItem?.type === 'text') {
      expect(textItem.text).toContain('describe this image');
    }

    // The local_image entries precede the text entry, matching the ordering
    // used for reference images in the media-generation Codex adapter.
    expect(inputItems.at(-1)?.type).toBe('text');
  });

  it('keeps a plain string prompt when no images are attached', async () => {
    const thread = createThread([
      { type: 'thread.started', thread_id: 'codex-thread-no-img' },
      {
        type: 'item.completed',
        item: { id: 'msg-1', type: 'agent_message', text: 'Done' },
      },
    ]);
    mocks.startThread.mockReturnValue(thread);

    const agent = new CodexAgent({ provider: 'codex' });
    const messages = [];
    for await (const message of agent.run('no images here', {
      taskId: 'task-local-image-2',
    })) {
      messages.push(message);
    }

    expect(thread.runStreamed).toHaveBeenCalledOnce();
    const input = thread.runStreamed.mock.calls[0]?.[0];
    expect(typeof input).toBe('string');
    expect(input as string).toContain('no images here');
  });
});
