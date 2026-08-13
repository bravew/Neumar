/**
 * Schedule MCP server — create-vs-manage gating regression tests.
 *
 * Regression for the Slack "can't cancel my automation" bug: the whole
 * schedule server used to be mounted only when the caller passed the
 * `schedule_create` connector gate, so non-admin channel users could not
 * cancel/pause automations their own channel owned. The server is now
 * always mounted when selected; only `schedule_create` is gated, via the
 * `allowCreate` context flag.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/automation/engine', () => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  toggle: vi.fn(),
  getRuns: vi.fn(() => []),
}));

import * as engine from '@/shared/automation/engine';
import { scheduleTools } from '@/shared/mcp/schedule-server';

const ownedAutomation = {
  id: 'auto-1',
  name: 'Daily Market Report',
  enabled: true,
  originChannel: {
    platform: 'slack',
    conversationId: 'C0AT2S0QFS9:1776289753.127889',
  },
  trigger: {
    type: 'cron',
    schedule: { kind: 'cron', cronExpr: '0 9 * * 1-5' },
  },
  runCount: 58,
  totalCost: 1.9,
} as never;

const channelContext = {
  platform: 'slack',
  // Same base channel, different thread — still owned by this channel.
  conversationId: 'C0AT2S0QFS9:1888888888.000001',
  configId: 'cfg-1',
  permissionTier: 'operator' as const,
  identityId: 'identity-1',
};

function toolByName(
  tools: ReturnType<typeof scheduleTools>,
  name: string,
): { handler: (args: never, extra: unknown) => Promise<unknown> } {
  const found = tools.find((t) => (t as { name: string }).name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return found as never;
}

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
};

describe('scheduleTools create-vs-manage gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(engine.list).mockReturnValue([ownedAutomation]);
  });

  it('registers all five tools even when allowCreate is false', () => {
    const tools = scheduleTools({
      sessionId: 's1',
      channelContext,
      allowCreate: false,
    });
    const names = tools.map((t) => (t as { name: string }).name).sort();
    expect(names).toEqual([
      'schedule_cancel',
      'schedule_create',
      'schedule_history',
      'schedule_list',
      'schedule_toggle',
    ]);
  });

  it('schedule_cancel still works for channel-owned automations when allowCreate is false', async () => {
    vi.mocked(engine.remove).mockResolvedValue(undefined as never);
    const tools = scheduleTools({
      sessionId: 's1',
      channelContext,
      allowCreate: false,
    });
    const result = (await toolByName(tools, 'schedule_cancel').handler(
      { nameOrId: 'Daily Market Report' } as never,
      {},
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(engine.remove).toHaveBeenCalledWith('auto-1');
    expect(result.content[0]!.text).toContain('cancelled');
  });

  it('schedule_toggle still works when allowCreate is false', async () => {
    vi.mocked(engine.toggle).mockResolvedValue(undefined as never);
    const tools = scheduleTools({
      sessionId: 's1',
      channelContext,
      allowCreate: false,
    });
    const result = (await toolByName(tools, 'schedule_toggle').handler(
      { nameOrId: 'auto-1', enabled: false } as never,
      {},
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(engine.toggle).toHaveBeenCalledWith('auto-1', false);
  });

  it('schedule_create is refused with the canonical denial copy when allowCreate is false', async () => {
    const tools = scheduleTools({
      sessionId: 's1',
      channelContext,
      allowCreate: false,
    });
    const result = (await toolByName(tools, 'schedule_create').handler(
      {
        name: 'New Task',
        prompt: 'do something',
        scheduleType: 'cron',
        cronExpr: '0 8 * * *',
      } as never,
      {},
    )) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(
      'Only admins can create new automations',
    );
    expect(engine.create).not.toHaveBeenCalled();
  });

  it('schedule_create keeps working when allowCreate is omitted (desktop default)', async () => {
    vi.mocked(engine.create).mockResolvedValue({
      id: 'auto-2',
      name: 'New Task',
      expiresAt: undefined,
      maxRuns: undefined,
    } as never);
    const tools = scheduleTools({ sessionId: 's1' });
    const result = (await toolByName(tools, 'schedule_create').handler(
      {
        name: 'New Task',
        prompt: 'do something',
        scheduleType: 'cron',
        cronExpr: '0 8 * * *',
      } as never,
      {},
    )) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(engine.create).toHaveBeenCalled();
  });
});
