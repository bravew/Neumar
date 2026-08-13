import type { NormalizedMessage } from '../types';

export interface LarkMessageResource {
  type: 'image' | 'file' | 'media' | 'audio';
  fileKey: string;
  fileName?: string;
}

export interface LarkMessageReceiveEvent {
  sender?: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string };
    sender_type?: string;
    tenant_key?: string;
  };
  message?: {
    message_id?: string;
    root_id?: string;
    parent_id?: string;
    thread_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
    create_time?: string;
    mentions?: Array<{
      key?: string;
      name?: string;
      id?: { open_id?: string; user_id?: string; union_id?: string } | string;
    }>;
  };
}

export interface LarkReactionEvent {
  message_id?: string;
  reaction_type?: { emoji_type?: string };
  user_id?: { open_id?: string; user_id?: string; union_id?: string };
}

export interface LarkCardActionEvent {
  open_id?: string;
  user_id?: string;
  open_message_id?: string;
  action?: {
    value?: {
      kind?: string;
      formId?: string;
      customId?: string;
      value?: string;
      label?: string;
    };
    option?: string;
    tag?: string;
  };
}

export function normalizeLarkMessageEvent(
  data: { event?: LarkMessageReceiveEvent } | LarkMessageReceiveEvent,
  configId: string,
): NormalizedMessage | null {
  const event = unwrapLarkEvent(data);
  const message = event.message;
  const senderId = senderIdFromEvent(event);
  if (!message?.message_id || !senderId) return null;

  const parsed = parseLarkMessageContent(
    message.message_type ?? 'text',
    message.content ?? '',
  );
  const text = replaceMentions(parsed.text.trim(), message.mentions);
  if (!text && parsed.resources.length === 0) return null;

  const conversationId =
    message.thread_id ?? message.root_id ?? message.chat_id;
  if (!conversationId) return null;
  const isCommand = text.startsWith('/');
  const commandParts = isCommand ? text.slice(1).split(/\s+/) : [];

  return {
    platform: 'lark',
    configId,
    messageId: message.message_id,
    conversationId,
    sessionKey: conversationId,
    userId: senderId,
    text,
    attachments:
      parsed.resources.length > 0
        ? parsed.resources.map(
            (resource) =>
              `lark-resource://${message.message_id}/${resource.type}/${resource.fileKey}`,
          )
        : undefined,
    isCommand,
    commandName: isCommand ? commandParts[0]?.toLowerCase() : undefined,
    commandArgs: isCommand ? commandParts.slice(1) : undefined,
    metadata: {
      chatId: message.chat_id,
      threadId: message.thread_id ?? message.root_id ?? message.parent_id,
      chatType: message.chat_type,
      messageType: message.message_type,
      larkResources: parsed.resources,
    },
  };
}

export function normalizeLarkReactionEvent(params: {
  event: LarkReactionEvent;
  action: 'added' | 'removed';
  configId: string;
  conversationId?: string;
}): NormalizedMessage | null {
  const messageId = params.event.message_id;
  if (!messageId) return null;
  const userId =
    params.event.user_id?.open_id ??
    params.event.user_id?.union_id ??
    params.event.user_id?.user_id ??
    'unknown';
  const emoji = params.event.reaction_type?.emoji_type ?? 'reaction';
  const conversationId = params.conversationId ?? messageId;
  return {
    platform: 'lark',
    configId: params.configId,
    messageId,
    conversationId,
    sessionKey: conversationId,
    userId,
    text: `reaction_${params.action}: ${emoji}`,
    isCommand: false,
    metadata: {
      kind: 'reaction',
      action: params.action,
      emoji,
      messageId,
    },
  };
}

export function normalizeLarkCardAction(
  data: LarkCardActionEvent,
  configId: string,
): NormalizedMessage | null {
  const value = data.action?.value;
  const selected = data.action?.option;
  const text = selected ?? value?.value ?? value?.label ?? '';
  if (!text) return null;
  const conversationId = data.open_message_id ?? value?.formId ?? 'card-action';
  return {
    platform: 'lark',
    configId,
    messageId: data.open_message_id ?? null,
    conversationId,
    sessionKey: conversationId,
    userId: data.open_id ?? data.user_id ?? 'unknown',
    text,
    isCommand: false,
    metadata: {
      kind: 'card_action',
      customId: value?.customId,
      actionKind: value?.kind,
      selected,
    },
  };
}

export function parseLarkMessageContent(
  messageType: string,
  content: string,
): { text: string; resources: LarkMessageResource[] } {
  const parsed = safeJson(content);
  if (messageType === 'text') {
    return { text: stringValue(parsed, 'text') ?? content, resources: [] };
  }
  if (messageType === 'post') return parsePostContent(parsed);
  if (messageType === 'image') {
    const imageKey = stringValue(parsed, 'image_key');
    return {
      text: imageKey ? '[image]' : '',
      resources: imageKey ? [{ type: 'image', fileKey: imageKey }] : [],
    };
  }
  if (
    messageType === 'file' ||
    messageType === 'media' ||
    messageType === 'audio'
  ) {
    const fileKey =
      stringValue(parsed, 'file_key') ?? stringValue(parsed, 'key');
    const fileName =
      stringValue(parsed, 'file_name') ?? stringValue(parsed, 'name');
    return {
      text: fileName ? `[${messageType}: ${fileName}]` : `[${messageType}]`,
      resources: fileKey
        ? [
            {
              type: messageType as LarkMessageResource['type'],
              fileKey,
              fileName,
            },
          ]
        : [],
    };
  }
  return { text: content, resources: [] };
}

function parsePostContent(value: unknown): {
  text: string;
  resources: LarkMessageResource[];
} {
  const resources: LarkMessageResource[] = [];
  const parts: string[] = [];
  const root =
    isRecord(value) && isRecord(value.content) ? value.content : value;

  walkPost(root, parts, resources);
  const title = stringValue(value, 'title');
  return {
    text: [title, parts.join('').trim()].filter(Boolean).join('\n'),
    resources,
  };
}

function walkPost(
  value: unknown,
  parts: string[],
  resources: LarkMessageResource[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkPost(item, parts, resources);
    }
    parts.push('\n');
    return;
  }
  if (!isRecord(value)) return;

  const tag = stringValue(value, 'tag');
  if (tag === 'text' || tag === 'a') {
    parts.push(stringValue(value, 'text') ?? '');
  } else if (tag === 'at') {
    parts.push(
      `@${stringValue(value, 'user_name') ?? stringValue(value, 'name') ?? 'user'}`,
    );
  } else if (tag === 'img') {
    const imageKey = stringValue(value, 'image_key');
    if (imageKey) resources.push({ type: 'image', fileKey: imageKey });
    parts.push('[image]');
  } else if (tag === 'media' || tag === 'file') {
    const fileKey = stringValue(value, 'file_key') ?? stringValue(value, 'key');
    const fileName =
      stringValue(value, 'file_name') ?? stringValue(value, 'name');
    if (fileKey) {
      resources.push({
        type: tag === 'media' ? 'media' : 'file',
        fileKey,
        fileName,
      });
    }
    parts.push(fileName ? `[${tag}: ${fileName}]` : `[${tag}]`);
  } else if (tag === 'emotion') {
    parts.push(`:${stringValue(value, 'emoji_type') ?? 'emoji'}:`);
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) walkPost(child, parts, resources);
  }
}

function replaceMentions(text: string, mentions?: LarkMessageMentions): string {
  let out = text;
  for (const mention of mentions ?? []) {
    if (mention.key && mention.name) {
      out = out.replaceAll(mention.key, `@${mention.name}`);
    }
  }
  return out;
}

function senderIdFromEvent(event: LarkMessageReceiveEvent): string {
  return (
    event.sender?.sender_id?.open_id ??
    event.sender?.sender_id?.union_id ??
    event.sender?.sender_id?.user_id ??
    ''
  );
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function unwrapLarkEvent(
  data: { event?: LarkMessageReceiveEvent } | LarkMessageReceiveEvent,
): LarkMessageReceiveEvent {
  return isRecord(data) && isRecord(data.event)
    ? (data.event as LarkMessageReceiveEvent)
    : (data as LarkMessageReceiveEvent);
}

type LarkMessageMentions = NonNullable<
  LarkMessageReceiveEvent['message']
>['mentions'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' ? item : undefined;
}
