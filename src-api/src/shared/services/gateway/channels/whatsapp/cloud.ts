import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { parseInteractiveMarkdown } from '@/shared/channels/_shared/interactive';
import { downloadWithRedirects } from '@/shared/channels/_shared/media';

import type { InboundMessage, OutboundContent } from '../types';

/** Default Meta Graph API version used when a config doesn't pin one. */
export const DEFAULT_WHATSAPP_GRAPH_VERSION = 'v20.0';

export interface WhatsAppCloudConfig {
  mode: 'cloud';
  phoneNumberId: string;
  wabaId?: string;
  accessToken: string;
  webhookVerifyToken: string;
  appSecret: string;
  graphVersion?: string;
}

export function parseWhatsAppCloudConfig(raw: unknown): WhatsAppCloudConfig {
  const cfg = raw as Partial<WhatsAppCloudConfig>;
  if (cfg.mode !== 'cloud') {
    throw new Error('WhatsApp Cloud API requires mode: "cloud"');
  }
  if (
    !cfg.phoneNumberId ||
    !cfg.accessToken ||
    !cfg.webhookVerifyToken ||
    !cfg.appSecret
  ) {
    throw new Error(
      'WhatsApp Cloud API requires phoneNumberId, accessToken, webhookVerifyToken, and appSecret',
    );
  }
  return {
    mode: 'cloud',
    phoneNumberId: cfg.phoneNumberId,
    accessToken: cfg.accessToken,
    webhookVerifyToken: cfg.webhookVerifyToken,
    appSecret: cfg.appSecret,
    ...(cfg.wabaId ? { wabaId: cfg.wabaId } : {}),
    ...(cfg.graphVersion ? { graphVersion: cfg.graphVersion } : {}),
  };
}

export function normalizeWhatsAppTarget(raw: string): string {
  const target = raw.trim();
  const match = /^([^:]+):(\+?\d{7,15})$/.exec(target);
  const candidate = match ? match[2]! : target;
  if (!/^\+?\d{7,15}$/.test(candidate)) {
    throw new Error('WhatsApp target must be E.164 or phoneNumberId:E.164');
  }
  return candidate.replace(/^\+/, '');
}

export function verifyWhatsAppSignature(params: {
  body: string;
  appSecret: string;
  signature?: string | null;
}): boolean {
  // Reject when the secret is missing — a public webhook endpoint must never
  // accept unverified payloads, even if the stored config is corrupted.
  if (!params.appSecret) return false;
  if (!params.signature) return false;
  const expected = crypto
    .createHmac('sha256', params.appSecret)
    .update(params.body)
    .digest('hex');
  const provided = params.signature.replace(/^sha256=/i, '').trim();
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyWhatsAppChallenge(
  query: URLSearchParams,
  verifyToken: string,
): string | null {
  if (
    query.get('hub.mode') === 'subscribe' &&
    query.get('hub.verify_token') === verifyToken
  ) {
    return query.get('hub.challenge') ?? '';
  }
  return null;
}

export function normalizeWhatsAppWebhook(
  body: unknown,
  options: { graphVersion?: string } = {},
): InboundMessage[] {
  const messages: InboundMessage[] = [];
  const root = isRecord(body) ? body : {};
  const graphVersion = options.graphVersion ?? DEFAULT_WHATSAPP_GRAPH_VERSION;
  for (const entry of arrayValue(root, 'entry')) {
    for (const change of arrayValue(entry, 'changes')) {
      const value = recordValue(change, 'value');
      if (!value) continue;
      const names = contactNameMap(value);
      for (const message of arrayValue(value, 'messages')) {
        const normalized = normalizeMessage(message, names, graphVersion);
        if (normalized) messages.push(normalized);
      }
      for (const status of arrayValue(value, 'statuses')) {
        const normalized = normalizeStatus(status);
        if (normalized) messages.push(normalized);
      }
    }
  }
  return messages;
}

export function buildWhatsAppMessagePayload(
  to: string,
  content: OutboundContent,
): Record<string, unknown> {
  const media = content as unknown as {
    __whatsapp_media_type?: 'image' | 'video' | 'audio' | 'document';
    __whatsapp_media_id?: string;
  };
  if (media.__whatsapp_media_type && media.__whatsapp_media_id) {
    return {
      messaging_product: 'whatsapp',
      to,
      type: media.__whatsapp_media_type,
      [media.__whatsapp_media_type]: { id: media.__whatsapp_media_id },
    };
  }

  const interactive = parseInteractiveMarkdown(content.text);
  const buttonBlock = interactive.blocks.find(
    (block) => block.kind === 'buttons',
  );
  const selectBlock = interactive.blocks.find(
    (block) => block.kind === 'select' || block.kind === 'overflow',
  );

  if (buttonBlock?.kind === 'buttons') {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: interactive.cleanText || content.text || 'Choose:' },
        action: {
          buttons: buttonBlock.items.slice(0, 3).map((item, index) => ({
            type: 'reply',
            reply: {
              id: item.value || `button_${index}`,
              title: item.label.slice(0, 20),
            },
          })),
        },
      },
    };
  }

  if (
    selectBlock &&
    (selectBlock.kind === 'select' || selectBlock.kind === 'overflow')
  ) {
    const options =
      selectBlock.kind === 'select' ? selectBlock.options : selectBlock.items;
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: interactive.cleanText || content.text || 'Choose:' },
        action: {
          button: 'Choose',
          sections: [
            {
              title:
                selectBlock.kind === 'select'
                  ? selectBlock.placeholder.slice(0, 24)
                  : 'Options',
              rows: options.slice(0, 10).map((option) => ({
                id: option.value.slice(0, 200),
                title: option.label.slice(0, 24),
              })),
            },
          ],
        },
      },
    };
  }

  return {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body: content.text.slice(0, 4096),
    },
  };
}

export async function sendWhatsAppCloudMessage(params: {
  config: WhatsAppCloudConfig;
  to: string;
  content: OutboundContent;
  fetchFn?: typeof fetch;
  retryDelayMs?: number;
}): Promise<string> {
  const payload = buildWhatsAppMessagePayload(params.to, params.content);
  const response = await graphFetch({
    config: params.config,
    path: `/${params.config.phoneNumberId}/messages`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    fetchFn: params.fetchFn,
    retryDelayMs: params.retryDelayMs,
  });
  const json = (await response.json().catch(() => null)) as {
    messages?: Array<{ id?: string }>;
  } | null;
  return json?.messages?.[0]?.id ?? '';
}

export async function uploadWhatsAppMedia(params: {
  config: WhatsAppCloudConfig;
  filePath: string;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const stat = await fs.stat(params.filePath);
  if (stat.size > 100 * 1024 * 1024) {
    throw new Error(
      `WhatsApp media exceeds 100MB: ${path.basename(params.filePath)}`,
    );
  }
  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set(
    'file',
    new Blob([await fs.readFile(params.filePath)]),
    path.basename(params.filePath),
  );
  const response = await graphFetch({
    config: params.config,
    path: `/${params.config.phoneNumberId}/media`,
    init: { method: 'POST', body: form },
    fetchFn: params.fetchFn,
  });
  const json = (await response.json().catch(() => null)) as {
    id?: string;
  } | null;
  if (!json?.id) throw new Error('WhatsApp media upload returned no id');
  return json.id;
}

export async function downloadWhatsAppMedia(params: {
  config: WhatsAppCloudConfig;
  mediaId: string;
  outputPath: string;
}): Promise<void> {
  const metadata = await graphFetch({
    config: params.config,
    path: `/${params.mediaId}`,
    init: { method: 'GET' },
  });
  const json = (await metadata.json().catch(() => null)) as {
    url?: string;
  } | null;
  if (!json?.url) throw new Error('WhatsApp media metadata returned no url');
  const media = await downloadWithRedirects(json.url, {
    auth: `Bearer ${params.config.accessToken}`,
    timeoutMs: 30_000,
  });
  if (!media.ok)
    throw new Error(`WhatsApp media download failed: ${media.status}`);
  await fs.writeFile(params.outputPath, Buffer.from(await media.arrayBuffer()));
}

async function graphFetch(params: {
  config: WhatsAppCloudConfig;
  path: string;
  init: RequestInit;
  fetchFn?: typeof fetch;
  retryDelayMs?: number;
}): Promise<Response> {
  const fetchFn = params.fetchFn ?? fetch;
  const version = params.config.graphVersion ?? DEFAULT_WHATSAPP_GRAPH_VERSION;
  const url = `https://graph.facebook.com/${version}${params.path}`;
  let attempt = 0;
  let delay = params.retryDelayMs ?? 500;
  while (true) {
    const response = await fetchFn(url, {
      ...params.init,
      headers: {
        Authorization: `Bearer ${params.config.accessToken}`,
        ...(params.init.headers as Record<string, string> | undefined),
      },
    });
    if (response.status !== 429 && response.status < 500) {
      if (!response.ok) {
        throw new Error(`WhatsApp Graph API failed: ${response.status}`);
      }
      return response;
    }
    attempt++;
    if (attempt >= 3)
      throw new Error(`WhatsApp Graph API failed: ${response.status}`);
    await sleep(Math.min(delay, 30_000));
    delay *= 2;
  }
}

function normalizeMessage(
  message: Record<string, unknown>,
  names: Map<string, string>,
  graphVersion: string,
): InboundMessage | null {
  const id = stringValue(message, 'id');
  const from = stringValue(message, 'from');
  if (!id || !from) return null;
  const type = stringValue(message, 'type') ?? 'text';
  const parsed = messageContent(message, type);
  return {
    channelId: 'whatsapp',
    chatId: from,
    senderId: from,
    senderName: names.get(from) ?? from,
    content: parsed.text,
    contentType: parsed.contentType,
    attachments: parsed.mediaId
      ? [
          {
            url: `https://graph.facebook.com/${graphVersion}/${parsed.mediaId}`,
            contentType: parsed.mimeType,
            filename: parsed.fileName,
          },
        ]
      : undefined,
    messageId: id,
    timestamp: new Date(
      Number(stringValue(message, 'timestamp') ?? '0') * 1000,
    ).toISOString(),
    raw: message,
  };
}

function normalizeStatus(
  status: Record<string, unknown>,
): InboundMessage | null {
  const id = stringValue(status, 'id');
  const recipient = stringValue(status, 'recipient_id');
  const value = stringValue(status, 'status');
  if (!id || !recipient || !value) return null;
  return {
    channelId: 'whatsapp',
    chatId: recipient,
    senderId: recipient,
    senderName: recipient,
    content: `status: ${value}`,
    contentType: 'text',
    messageId: id,
    timestamp: new Date(
      Number(stringValue(status, 'timestamp') ?? '0') * 1000,
    ).toISOString(),
    raw: status,
  };
}

function messageContent(
  message: Record<string, unknown>,
  type: string,
): {
  text: string;
  contentType: InboundMessage['contentType'];
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
} {
  if (type === 'text') {
    return {
      text: stringValue(recordValue(message, 'text'), 'body') ?? '',
      contentType: 'text',
    };
  }
  if (type === 'button') {
    return {
      text: stringValue(recordValue(message, 'button'), 'text') ?? '',
      contentType: 'text',
    };
  }
  if (type === 'interactive') {
    const interactive = recordValue(message, 'interactive');
    const reply =
      recordValue(interactive, 'button_reply') ??
      recordValue(interactive, 'list_reply');
    return {
      text:
        stringValue(reply, 'id') ??
        stringValue(reply, 'title') ??
        '[interactive]',
      contentType: 'text',
    };
  }
  const media = recordValue(message, type);
  const id = stringValue(media, 'id');
  return {
    text: id ? `[${type}]` : '',
    contentType:
      type === 'audio' ? 'voice' : type === 'image' ? 'image' : 'file',
    mediaId: id,
    mimeType: stringValue(media, 'mime_type'),
    fileName: stringValue(media, 'filename'),
  };
}

function contactNameMap(value: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const contact of arrayValue(value, 'contacts')) {
    const waId = stringValue(contact, 'wa_id');
    const profile = recordValue(contact, 'profile');
    const name = stringValue(profile, 'name');
    if (waId && name) out.set(waId, name);
  }
  return out;
}

function arrayValue(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function recordValue(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function stringValue(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
