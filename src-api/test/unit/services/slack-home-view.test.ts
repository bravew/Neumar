import { describe, expect, it } from 'vitest';

import type { HomeState } from '@/shared/channels/slack/home/state';
import {
  HOME_ACTION_IDS,
  buildHomeView,
} from '@/shared/channels/slack/home/view';

const baseState = (overrides: Partial<HomeState> = {}): HomeState => ({
  slackTeamId: 'T0001',
  slackUserId: 'U9999',
  configId: 'cfg-1',
  appVersion: '99.9.9',
  botName: 'Optimus',
  link: null,
  credentials: [],
  mcp: [],
  mcpPolicy: 'open',
  ...overrides,
});

function pairedLink(routingMode: 'auto' | 'chat' | 'task') {
  return {
    slackTeamId: 'T0001',
    slackUserId: 'U9999',
    configId: 'cfg-1',
    channelUserId: null,
    email: 'alex@acme.test',
    displayName: 'Alex',
    routingMode,
    notifyOnDone: false,
    linkedAt: '2026-04-27',
    lastSeenAt: null,
  };
}

describe('buildHomeView', () => {
  it('returns a Slack-compatible home view', () => {
    const view = buildHomeView(baseState());
    expect(view.type).toBe('home');
    expect(Array.isArray(view.blocks)).toBe(true);
    expect(view.blocks.length).toBeLessThanOrEqual(100);
  });

  it('renders the unpaired prompt with both connect actions', () => {
    const view = buildHomeView(baseState());
    const json = JSON.stringify(view);
    expect(json).toContain('Welcome to Optimus');
    expect(json).toContain('Connect with Optimus');
    expect(json).toContain(HOME_ACTION_IDS.CONNECT_HOSTED);
    expect(json).toContain(HOME_ACTION_IDS.CONNECT_PAIRING);
    // Disconnect / routing must not appear before pairing.
    expect(json).not.toContain(HOME_ACTION_IDS.DISCONNECT);
    expect(json).not.toContain(HOME_ACTION_IDS.ROUTING_MODE);
  });

  it('renders the paired view with routing radio + disconnect + live sections', () => {
    const view = buildHomeView(
      baseState({
        link: {
          slackTeamId: 'T0001',
          slackUserId: 'U9999',
          configId: 'cfg-1',
          channelUserId: 'cu-1',
          email: 'alex@acme.test',
          displayName: 'Alex',
          routingMode: 'task',
          notifyOnDone: true,
          linkedAt: '2026-04-27T00:00:00Z',
          lastSeenAt: '2026-04-27T01:00:00Z',
        },
      }),
    );
    const json = JSON.stringify(view);
    expect(json).toContain('alex@acme.test');
    expect(json).toContain(HOME_ACTION_IDS.ROUTING_MODE);
    expect(json).toContain(HOME_ACTION_IDS.DISCONNECT);
    expect(json).toContain('Connections');
    expect(json).toContain('Custom tools (MCP)');
    expect(json).toContain(HOME_ACTION_IDS.CRED_ADD);
    expect(json).toContain(HOME_ACTION_IDS.MCP_ADD);
  });

  it('shows a "What can you do here?" hint only when the user has no creds or MCPs', () => {
    const pristine = buildHomeView(baseState({ link: pairedLink('auto') }));
    expect(JSON.stringify(pristine)).toContain('What can you do here?');

    const populated = buildHomeView(
      baseState({
        link: pairedLink('auto'),
        credentials: [
          {
            connector: {
              key: 'github',
              displayName: 'GitHub',
              hint: '',
              tokenUrl: '',
            },
            credential: {
              slackTeamId: 'T0001',
              slackUserId: 'U9999',
              provider: 'github',
              accountLabel: 'alex',
              tokenHint: 'abcd',
              scopes: [],
              expiresAt: null,
              connectedAt: '2026-04-27',
            },
          },
        ],
      }),
    );
    expect(JSON.stringify(populated)).not.toContain('What can you do here?');
  });

  it('preserves the user-selected routing mode as the radio initial_option', () => {
    for (const mode of ['auto', 'chat', 'task'] as const) {
      const view = buildHomeView(
        baseState({
          link: {
            slackTeamId: 'T',
            slackUserId: 'U',
            configId: 'c',
            channelUserId: null,
            email: null,
            displayName: null,
            routingMode: mode,
            notifyOnDone: false,
            linkedAt: '2026-04-27',
            lastSeenAt: null,
          },
        }),
      );
      const radio = view.blocks
        .flatMap((b) => ('elements' in b ? (b.elements as unknown[]) : []))
        .find(
          (e): e is { type: string; initial_option?: { value?: string } } =>
            !!e &&
            typeof e === 'object' &&
            (e as { type?: string }).type === 'radio_buttons',
        );
      expect(radio?.initial_option?.value).toBe(mode);
    }
  });

  it('hides the MCP section when policy is disabled', () => {
    const view = buildHomeView(
      baseState({
        link: pairedLink('auto'),
        mcpPolicy: 'disabled',
      }),
    );
    const json = JSON.stringify(view);
    expect(json).not.toContain('Custom tools (MCP)');
    expect(json).not.toContain(HOME_ACTION_IDS.MCP_ADD);
  });

  it('shows the admin-approval banner when policy is admin-approved', () => {
    const view = buildHomeView(
      baseState({
        link: pairedLink('auto'),
        mcpPolicy: 'admin-approved',
      }),
    );
    const json = JSON.stringify(view);
    expect(json).toContain('admin approval');
  });

  it('truncates long emails so block limits are not exceeded', () => {
    const longEmail = 'x'.repeat(5000) + '@example.com';
    const view = buildHomeView(
      baseState({
        link: {
          slackTeamId: 'T',
          slackUserId: 'U',
          configId: 'c',
          channelUserId: null,
          email: longEmail,
          displayName: null,
          routingMode: 'auto',
          notifyOnDone: false,
          linkedAt: '2026-04-27',
          lastSeenAt: null,
        },
      }),
    );
    // Slack section text is capped at 3000 chars; clip enforces that.
    const sections = view.blocks.filter((b) => b.type === 'section');
    for (const s of sections) {
      const text = (s as { text?: { text?: string } }).text?.text ?? '';
      expect(text.length).toBeLessThanOrEqual(3000);
    }
  });
});
