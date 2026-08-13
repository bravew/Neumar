/**
 * Modal view builders for App Home flows.
 */

import type { ModalView } from '@slack/types';

import type { McpTransport } from '@/shared/db/operations-slack-home';

import { listCredentialConnectors } from './credentials';
import type { McpPreset } from './mcp-presets';
import { HOME_CALLBACK_IDS } from './view';

export const PAIRING_INPUT_BLOCK_ID = 'home:pairing:code_block';
export const PAIRING_INPUT_ACTION_ID = 'home:pairing:code_input';

/**
 * Pairing-code modal. The block_id / action_id pair is read out of
 * `view.state.values[block_id][action_id].value` on `view_submission`.
 *
 * `private_metadata` carries the slack identity so the submission handler
 * doesn't have to re-derive it; we never put secrets here — just IDs that
 * are already in the block_actions payload anyway.
 */
export function buildPairingCodeModal(args: {
  slackTeamId: string;
  slackUserId: string;
}): ModalView {
  return {
    type: 'modal',
    callback_id: HOME_CALLBACK_IDS.PAIRING_MODAL,
    private_metadata: JSON.stringify({
      slackTeamId: args.slackTeamId,
      slackUserId: args.slackUserId,
    }),
    title: { type: 'plain_text', text: 'Connect with Neumar' },
    submit: { type: 'plain_text', text: 'Connect' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Paste the pairing code from Settings → Channels → Slack in the desktop app. Codes expire shortly after they are issued.',
        },
      },
      {
        type: 'input',
        block_id: PAIRING_INPUT_BLOCK_ID,
        label: { type: 'plain_text', text: 'Pairing code' },
        element: {
          type: 'plain_text_input',
          action_id: PAIRING_INPUT_ACTION_ID,
          min_length: 4,
          max_length: 32,
          placeholder: { type: 'plain_text', text: 'e.g. 7K2P9X' },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// MCP add modal
// ---------------------------------------------------------------------------

export const MCP_BLOCK_IDS = {
  NAME: 'home:mcp:name',
  TRANSPORT: 'home:mcp:transport',
  URL: 'home:mcp:url',
  HEADERS: 'home:mcp:headers',
} as const;

export const MCP_ACTION_IDS = {
  NAME: 'home:mcp:name_input',
  TRANSPORT: 'home:mcp:transport_select',
  URL: 'home:mcp:url_input',
  HEADERS: 'home:mcp:headers_input',
} as const;

const HTTP_TRANSPORTS: ReadonlyArray<{ value: McpTransport; label: string }> = [
  { value: 'http', label: 'HTTP (Streamable)' },
  { value: 'sse', label: 'SSE (legacy)' },
];

/**
 * MCP add modal — v1 ships HTTP-only because stdio servers from a Slack
 * modal are too dangerous to probe (we'd be spawning user-supplied processes
 * on the desktop sidecar). stdio support lands when the desktop UI gets a
 * proper "Trust this command" confirmation surface.
 */
export function buildMcpAddModal(args: {
  slackTeamId: string;
  slackUserId: string;
}): ModalView {
  return {
    type: 'modal',
    callback_id: HOME_CALLBACK_IDS.MCP_ADD_MODAL,
    private_metadata: JSON.stringify({
      slackTeamId: args.slackTeamId,
      slackUserId: args.slackUserId,
    }),
    title: { type: 'plain_text', text: 'Add a custom tool' },
    submit: { type: 'plain_text', text: 'Add' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Connect a Model Context Protocol server you own. Only HTTP transports are accepted from Slack today; stdio servers must be added from the desktop app for safety.',
        },
      },
      {
        type: 'input',
        block_id: MCP_BLOCK_IDS.NAME,
        label: { type: 'plain_text', text: 'Name' },
        element: {
          type: 'plain_text_input',
          action_id: MCP_ACTION_IDS.NAME,
          min_length: 1,
          max_length: 64,
          placeholder: { type: 'plain_text', text: 'e.g. firecrawl' },
        },
      },
      {
        type: 'input',
        block_id: MCP_BLOCK_IDS.TRANSPORT,
        label: { type: 'plain_text', text: 'Transport' },
        element: {
          type: 'static_select',
          action_id: MCP_ACTION_IDS.TRANSPORT,
          initial_option: {
            value: HTTP_TRANSPORTS[0]!.value,
            text: { type: 'plain_text', text: HTTP_TRANSPORTS[0]!.label },
          },
          options: HTTP_TRANSPORTS.map((t) => ({
            value: t.value,
            text: { type: 'plain_text' as const, text: t.label },
          })),
        },
      },
      {
        type: 'input',
        block_id: MCP_BLOCK_IDS.URL,
        label: { type: 'plain_text', text: 'URL' },
        element: {
          type: 'plain_text_input',
          action_id: MCP_ACTION_IDS.URL,
          placeholder: {
            type: 'plain_text',
            text: 'https://example.com/mcp',
          },
        },
      },
      {
        type: 'input',
        block_id: MCP_BLOCK_IDS.HEADERS,
        optional: true,
        label: { type: 'plain_text', text: 'Headers (KEY=value per line)' },
        hint: {
          type: 'plain_text',
          text: 'Stored encrypted with your per-user key. Used as request headers.',
        },
        element: {
          // Slack caps `plain_text_input.max_length` at 3000.
          type: 'plain_text_input',
          action_id: MCP_ACTION_IDS.HEADERS,
          multiline: true,
          max_length: 3000,
          placeholder: {
            type: 'plain_text',
            text: 'Authorization=Bearer xxx\nX-API-Key=yyy',
          },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Personal-credential add modal
// ---------------------------------------------------------------------------

export const CRED_BLOCK_IDS = {
  PROVIDER: 'home:cred:provider',
  TOKEN: 'home:cred:token',
  LABEL: 'home:cred:label',
} as const;

export const CRED_ACTION_IDS = {
  PROVIDER: 'home:cred:provider_select',
  TOKEN: 'home:cred:token_input',
  LABEL: 'home:cred:label_input',
} as const;

export function buildCredentialAddModal(args: {
  slackTeamId: string;
  slackUserId: string;
  preselectProvider?: string;
}): ModalView {
  const connectors = listCredentialConnectors();
  const initial =
    connectors.find((c) => c.key === args.preselectProvider) ?? connectors[0]!;

  return {
    type: 'modal',
    callback_id: HOME_CALLBACK_IDS.CRED_ADD_MODAL,
    private_metadata: JSON.stringify({
      slackTeamId: args.slackTeamId,
      slackUserId: args.slackUserId,
    }),
    title: { type: 'plain_text', text: 'Add a connection' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Tokens are encrypted with your per-user key and never echoed back. Only the last 4 characters appear on the Home tab as a hint.',
        },
      },
      {
        type: 'input',
        block_id: CRED_BLOCK_IDS.PROVIDER,
        label: { type: 'plain_text', text: 'Connector' },
        element: {
          type: 'static_select',
          action_id: CRED_ACTION_IDS.PROVIDER,
          initial_option: {
            value: initial.key,
            text: { type: 'plain_text', text: initial.displayName },
          },
          options: connectors.map((c) => ({
            value: c.key,
            text: { type: 'plain_text' as const, text: c.displayName },
          })),
        },
      },
      {
        type: 'input',
        block_id: CRED_BLOCK_IDS.TOKEN,
        label: { type: 'plain_text', text: 'Token / API key' },
        hint: {
          type: 'plain_text',
          text: 'Pasted text is hidden in the input but visible during entry. Use a freshly minted key.',
        },
        element: {
          // Slack caps `plain_text_input.max_length` at 3000 — well above
          // any real PAT (GitHub fine-grained tokens are ~93 chars).
          type: 'plain_text_input',
          action_id: CRED_ACTION_IDS.TOKEN,
          min_length: 8,
          max_length: 3000,
          placeholder: { type: 'plain_text', text: 'Paste here' },
        },
      },
      {
        type: 'input',
        block_id: CRED_BLOCK_IDS.LABEL,
        optional: true,
        label: { type: 'plain_text', text: 'Label (optional)' },
        element: {
          type: 'plain_text_input',
          action_id: CRED_ACTION_IDS.LABEL,
          max_length: 80,
          placeholder: {
            type: 'plain_text',
            text: 'e.g. work account / personal',
          },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// MCP catalog "Quick add" modal — single-input flow that pastes a token
// for a hosted preset (GitHub, Notion, etc.) and saves the row with
// `Authorization=Bearer <token>` already wired.
// ---------------------------------------------------------------------------

export const MCP_PRESET_BLOCK_IDS = {
  TOKEN: 'home:mcp_preset:token',
} as const;

export const MCP_PRESET_ACTION_IDS = {
  TOKEN: 'home:mcp_preset:token_input',
} as const;

export function buildMcpPresetModal(args: {
  slackTeamId: string;
  slackUserId: string;
  preset: McpPreset;
}): ModalView {
  return {
    type: 'modal',
    callback_id: HOME_CALLBACK_IDS.MCP_PRESET_MODAL,
    private_metadata: JSON.stringify({
      slackTeamId: args.slackTeamId,
      slackUserId: args.slackUserId,
      presetKey: args.preset.key,
    }),
    title: { type: 'plain_text', text: `Add ${args.preset.displayName}` },
    submit: { type: 'plain_text', text: 'Add' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            args.preset.hint +
            `\n\n_<${args.preset.tokenUrl}|Mint a token>_ → paste below.`,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Endpoint: \`${args.preset.url}\`` },
        ],
      },
      {
        type: 'input',
        block_id: MCP_PRESET_BLOCK_IDS.TOKEN,
        label: { type: 'plain_text', text: 'Token' },
        element: {
          type: 'plain_text_input',
          action_id: MCP_PRESET_ACTION_IDS.TOKEN,
          min_length: 8,
          max_length: 3000,
          placeholder: {
            type: 'plain_text',
            text: args.preset.tokenPlaceholder ?? 'Paste here',
          },
        },
      },
    ],
  };
}

export function parseHeaderLines(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && value) headers[key] = value;
  }
  return headers;
}
