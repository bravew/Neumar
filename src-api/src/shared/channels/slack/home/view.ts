/**
 * Pure builder for the Slack App Home view. Takes a `HomeState` and
 * returns a `views.publish`-compatible payload. Kept free of Bolt or
 * `@slack/web-api` imports so unit tests can run without those dependencies.
 */

import type { HomeView, KnownBlock } from '@slack/types';

import { getMcpPreset, listMcpPresets } from './mcp-presets';
import type { HomeState } from './state';
import { ROUTING_MODE_OPTIONS } from './state';

/**
 * Block-action IDs emitted by Home buttons / inputs. Namespaced under
 * `home:*` rather than the existing `neuma:*` namespace so the broad
 * action handler at `slack/index.ts` does not double-dispatch.
 */
export const HOME_ACTION_IDS = {
  CONNECT_HOSTED: 'home:connect:hosted',
  CONNECT_PAIRING: 'home:connect:pairing',
  DISCONNECT: 'home:disconnect',
  ROUTING_MODE: 'home:routing_mode',
  /** Open the personal-credential add modal. */
  CRED_ADD: 'home:cred:add',
  /** Replace an existing credential (action_id includes provider key). */
  CRED_REPLACE_PREFIX: 'home:cred_replace:',
  /** Remove a credential (action_id includes provider key). */
  CRED_REMOVE_PREFIX: 'home:cred_remove:',
  /** Open MCP add modal (custom URL flow). */
  MCP_ADD: 'home:mcp:add',
  /** One-click add of a curated MCP preset (action_id includes preset key). */
  MCP_PRESET_PREFIX: 'home:mcp_preset:',
  /** Toggle (enable/disable) an MCP server. action_id includes id. */
  MCP_TOGGLE_PREFIX: 'home:mcp_toggle:',
  /** Remove an MCP server. action_id includes id. */
  MCP_REMOVE_PREFIX: 'home:mcp_remove:',
} as const;

export const HOME_CALLBACK_IDS = {
  PAIRING_MODAL: 'home:pairing_modal',
  CRED_ADD_MODAL: 'home:cred_add_modal',
  MCP_ADD_MODAL: 'home:mcp_add_modal',
  MCP_PRESET_MODAL: 'home:mcp_preset_modal',
} as const;

/** Slack hard-caps a published view at 100 blocks; we leave headroom. */
const MAX_BLOCKS = 100;

export function buildHomeView(state: HomeState): HomeView {
  const blocks = state.link
    ? buildPairedBlocks(state)
    : buildUnpairedBlocks(state);

  if (blocks.length > MAX_BLOCKS) {
    // Defensive truncation — should never trip given the Phase 1-2 surface,
    // but if a future section runs long we'd rather render a partial view
    // than crash the publish call.
    blocks.length = MAX_BLOCKS;
  }

  return { type: 'home', blocks };
}

function buildUnpairedBlocks(state: HomeState): KnownBlock[] {
  return [
    headerBlock(`Welcome to ${state.botName}`),
    section(
      `*${escapeMrkdwn(state.botName)}* turns Slack messages into agent runs.\nDM me a question for a quick answer, or hand me a task and I'll execute it end-to-end with the tools you connect here.`,
    ),
    section(
      '*Get started* by connecting your account so this bot recognises you and applies your personal credentials and tools.',
    ),
    {
      type: 'actions',
      elements: [
        primaryButton(
          `Connect with ${state.botName}`,
          HOME_ACTION_IDS.CONNECT_HOSTED,
        ),
        secondaryButton('Use a pairing code', HOME_ACTION_IDS.CONNECT_PAIRING),
      ],
    },
    { type: 'divider' },
    contextBlock([
      `${escapeMrkdwn(state.botName)} v${state.appVersion}`,
      'Workspace ' + state.slackTeamId,
      'Need a pairing code? Ask an admin to issue one in Settings → Channels.',
    ]),
  ];
}

function buildPairedBlocks(state: HomeState): KnownBlock[] {
  const { link } = state;
  if (!link) return buildUnpairedBlocks(state);

  // Status — emoji-led identity line ("most important content shines at top",
  // per https://docs.slack.dev/surfaces/app-design/). Mirrors Claude's
  // "Connected as <email> · <org>" pattern.
  const identityBits: string[] = [];
  identityBits.push(`✅ *Connected*`);
  if (link.email) identityBits.push(`as ${escapeMrkdwn(link.email)}`);
  identityBits.push(`to *${escapeMrkdwn(state.botName)}*`);

  const blocks: KnownBlock[] = [
    headerBlock(state.botName),
    section(identityBits.join(' ')),
    { type: 'divider' },

    // Routing — labelled then radio, matches Claude's prominent placement of
    // "Routing Mode" right under the identity block.
    section(
      '*Routing*\nChoose how this bot handles your messages. You can change this any time.',
    ),
    routingRadioBlock(link.routingMode),
    { type: 'divider' },

    // Connections — was "Personal credentials". Friendlier label; clarifies
    // the security model so the user trusts pasting tokens here.
    headerBlock('Connections'),
    section(
      'Connect tools so the agent can act on your behalf. Tokens are encrypted with your per-user key on this server and never echoed back — only the last 4 characters appear here as a hint.',
    ),
    ...buildCredentialBlocks(state),
    { type: 'divider' },
  ];

  if (state.mcpPolicy !== 'disabled') {
    blocks.push(
      headerBlock('Custom tools (MCP)'),
      section(
        'Bring your own Model Context Protocol servers. Only you see and use the servers you add here — they overlay the bot’s global tool list at runtime.',
      ),
      ...buildMcpBlocks(state),
      { type: 'divider' },
    );
  }

  // First-run guidance — only shown when the user has done nothing yet.
  // Claude's pattern: a small "what to try" prompt under the empty state.
  const isPristine =
    state.credentials.every((c) => c.credential === null) &&
    state.mcp.length === 0;
  if (isPristine) {
    blocks.push(
      headerBlock('What can you do here?'),
      section(
        '• DM me to chat or kick off a task\n• @-mention me in any channel I’m in to bring me into a thread\n• Connect a tool above, then ask me to use it ("draft a Linear ticket from this thread")',
      ),
      { type: 'divider' },
    );
  }

  // Disconnect lives in its own "danger zone" at the very bottom — Slack
  // design guidance: keep destructive actions away from primary controls.
  blocks.push(
    section(
      `*Disconnect*\nRemove the link between your Slack and ${escapeMrkdwn(state.botName)} accounts. Your saved tokens and MCP servers will be crypto-shredded.`,
    ),
    {
      type: 'actions',
      elements: [disconnectButton(state.botName)],
    },
    contextBlock([
      `${escapeMrkdwn(state.botName)} v${state.appVersion}`,
      `Workspace ${state.slackTeamId}`,
    ]),
  );

  return blocks;
}

// ---------------------------------------------------------------------------
// Block primitives — typed against `@slack/types` so views.publish accepts
// them without further casting.
// ---------------------------------------------------------------------------

function headerBlock(text: string): KnownBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text: clip(text, 150), emoji: true },
  };
}

function section(text: string): KnownBlock {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: clip(text, 3000) },
  };
}

function contextBlock(lines: string[]): KnownBlock {
  return {
    type: 'context',
    elements: lines.map((line) => ({
      type: 'mrkdwn' as const,
      text: clip(line, 150),
    })),
  };
}

type ButtonStyle = 'primary' | 'danger';

interface ButtonOptions {
  style?: ButtonStyle;
  confirm?: {
    title: string;
    body: string;
    confirm: string;
    deny: string;
    style?: ButtonStyle;
  };
}

function button(text: string, actionId: string, opts: ButtonOptions = {}) {
  const base = {
    type: 'button' as const,
    text: { type: 'plain_text' as const, text: clip(text, 75), emoji: true },
    action_id: actionId,
  };
  const withStyle = opts.style ? { ...base, style: opts.style } : base;
  if (!opts.confirm) return withStyle;
  return {
    ...withStyle,
    confirm: {
      title: { type: 'plain_text' as const, text: opts.confirm.title },
      text: { type: 'mrkdwn' as const, text: opts.confirm.body },
      confirm: { type: 'plain_text' as const, text: opts.confirm.confirm },
      deny: { type: 'plain_text' as const, text: opts.confirm.deny },
      ...(opts.confirm.style ? { style: opts.confirm.style } : {}),
    },
  };
}

const primaryButton = (text: string, actionId: string) =>
  button(text, actionId, { style: 'primary' });
const secondaryButton = (text: string, actionId: string) =>
  button(text, actionId);
const disconnectButton = (botName: string) =>
  button('Disconnect account', HOME_ACTION_IDS.DISCONNECT, {
    style: 'danger',
    confirm: {
      title: 'Disconnect?',
      body: `This removes your Slack ↔ ${botName} link and crypto-shreds every personal credential and MCP server you saved here.`,
      confirm: 'Disconnect',
      deny: 'Cancel',
      style: 'danger',
    },
  });

function routingRadioBlock(current: string): KnownBlock {
  return {
    type: 'actions',
    elements: [
      {
        type: 'radio_buttons',
        action_id: HOME_ACTION_IDS.ROUTING_MODE,
        initial_option: optionFor(current),
        options: ROUTING_MODE_OPTIONS.map((o) => ({
          value: o.value,
          text: { type: 'plain_text' as const, text: o.label },
          description: { type: 'plain_text' as const, text: o.description },
        })),
      },
    ],
  };
}

function optionFor(value: string) {
  // ROUTING_MODE_OPTIONS is non-empty by construction; the [0] fallback
  // is just so the TS narrowing matches the Slack option schema.
  const opt =
    ROUTING_MODE_OPTIONS.find((o) => o.value === value) ??
    ROUTING_MODE_OPTIONS[0]!;
  return {
    value: opt.value,
    text: { type: 'plain_text' as const, text: opt.label },
    description: { type: 'plain_text' as const, text: opt.description },
  };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Personal-credentials section builder (Phase 3a — token paste)
// ---------------------------------------------------------------------------

function buildCredentialBlocks(state: HomeState): KnownBlock[] {
  const out: KnownBlock[] = [];
  const connected = state.credentials.filter((c) => c.credential !== null);
  if (connected.length > 0) {
    for (const row of connected) {
      const cred = row.credential!;
      const hint = cred.tokenHint ? `…${cred.tokenHint}` : 'stored';
      const labelSuffix = cred.accountLabel
        ? ` · ${escapeMrkdwn(cred.accountLabel)}`
        : '';
      out.push(
        section(
          `*${row.connector.displayName}* — _token ${escapeMrkdwn(hint)}${labelSuffix}_`,
        ),
      );
      out.push({
        type: 'actions',
        elements: [
          button(
            'Update token',
            HOME_ACTION_IDS.CRED_REPLACE_PREFIX + row.connector.key,
          ),
          button(
            'Remove',
            HOME_ACTION_IDS.CRED_REMOVE_PREFIX + row.connector.key,
            { style: 'danger' },
          ),
        ],
      });
    }
  } else {
    out.push(
      section(
        '_No connections yet. Add one to let the agent act on your behalf when running tasks._',
      ),
    );
  }
  out.push({
    type: 'actions',
    elements: [primaryButton('Add a connection', HOME_ACTION_IDS.CRED_ADD)],
  });
  return out;
}

// ---------------------------------------------------------------------------
// MCP section builder (Phase 4)
// ---------------------------------------------------------------------------

function buildMcpBlocks(state: HomeState): KnownBlock[] {
  const out: KnownBlock[] = [];
  if (state.mcpPolicy === 'admin-approved') {
    out.push(
      section(
        '_This bot requires admin approval for MCP servers. New servers land in a pending list — your admin will review them in Settings → Channels._',
      ),
    );
  }

  // Quick-add catalog — buttons that open a single-input modal with the
  // hosted MCP URL pre-wired. Hides connectors the user already added.
  const installedNames = new Set(state.mcp.map((m) => m.name));
  const presets = listMcpPresets().filter((p) => !installedNames.has(p.key));
  if (presets.length > 0) {
    out.push(section('_Quick add — paste your token, the URL is pre-filled._'));
    // Per-preset row: small inline icon + label in a `context` block
    // (renders ~20px alongside text), followed by an `actions` block with
    // the Add button. Section accessory images render as 88×88 thumbnails
    // — too large for a compact catalog row.
    for (const p of presets) {
      out.push({
        type: 'context',
        elements: [
          {
            type: 'image',
            image_url: p.iconUrl,
            alt_text: p.displayName,
          },
          {
            type: 'mrkdwn',
            text: `*${escapeMrkdwn(p.displayName)}*`,
          },
        ],
      });
      out.push({
        type: 'actions',
        elements: [
          primaryButton(
            `Add ${p.displayName}`,
            HOME_ACTION_IDS.MCP_PRESET_PREFIX + p.key,
          ),
        ],
      });
    }
  }

  if (state.mcp.length === 0) {
    out.push(
      section(
        '_No custom tools yet. Quick-add one above, or hand-roll a server with the button below._',
      ),
    );
  } else {
    for (const row of state.mcp) {
      const status = row.pendingAdminApproval
        ? '⏳ Awaiting admin approval'
        : row.enabled
          ? '✅ Enabled'
          : '⏸ Disabled';
      const target =
        row.transport === 'stdio'
          ? `stdio: \`${escapeMrkdwn(row.command ?? '')}\``
          : `${row.transport}: ${escapeMrkdwn(row.url ?? '')}`;
      // Preset-installed rows surface the brand icon as a section image
      // accessory; hand-rolled MCP rows (no preset match) stay icon-less.
      const preset = getMcpPreset(row.name);
      if (preset) {
        out.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${escapeMrkdwn(preset.displayName)}*\n${target}\n${status}`,
          },
          accessory: {
            type: 'image',
            image_url: preset.iconUrl,
            alt_text: preset.displayName,
          },
        });
      } else {
        out.push(section(`*${escapeMrkdwn(row.name)}*\n${target}\n${status}`));
      }
      const elements: Array<ReturnType<typeof button>> = [];
      if (!row.pendingAdminApproval) {
        elements.push(
          button(
            row.enabled ? 'Disable' : 'Enable',
            HOME_ACTION_IDS.MCP_TOGGLE_PREFIX + row.id,
          ),
        );
      }
      elements.push(
        button('Remove', HOME_ACTION_IDS.MCP_REMOVE_PREFIX + row.id, {
          style: 'danger',
        }),
      );
      out.push({ type: 'actions', elements });
    }
  }
  out.push({
    type: 'actions',
    elements: [button('Add custom MCP', HOME_ACTION_IDS.MCP_ADD)],
  });
  return out;
}
