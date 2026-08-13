import crypto from 'node:crypto';

import type { InboundMessage } from '../types';

export interface BlueBubblesMessageEvent {
  guid: string;
  text?: string;
  chats?: Array<{ guid?: string; chatIdentifier?: string }>;
  handle?: { address?: string; uniqueId?: string };
  isFromMe?: boolean;
  dateCreated?: number;
  attachments?: Array<{
    url?: string;
    mimeType?: string;
    mime_type?: string;
    transferName?: string;
    transfer_name?: string;
  }>;
  associatedMessageType?: number;
  associatedMessageGuid?: string;
}

const TAPBACKS = new Map<number, string>([
  [2000, 'love'],
  [2001, 'like'],
  [2002, 'dislike'],
  [2003, 'laugh'],
  [2004, 'emphasize'],
  [2005, 'question'],
  [3000, 'removed_love'],
  [3001, 'removed_like'],
  [3002, 'removed_dislike'],
  [3003, 'removed_laugh'],
  [3004, 'removed_emphasize'],
  [3005, 'removed_question'],
]);

export function verifyBlueBubblesWebhook(params: {
  body: string;
  secret: string;
  signature?: string | null;
}): boolean {
  // Reject when the secret is missing — callers must explicitly skip this
  // function if signature verification is intentionally disabled.
  if (!params.secret) return false;
  if (!params.signature) return false;
  const expected = crypto
    .createHmac('sha256', params.secret)
    .update(params.body)
    .digest('hex');
  const provided = params.signature.replace(/^sha256=/i, '').trim();
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function normalizeBlueBubblesWebhook(
  eventType: string,
  payload: BlueBubblesMessageEvent,
): InboundMessage | null {
  if (payload.isFromMe) return null;
  const chatGuid = payload.chats?.[0]?.guid ?? '';
  if (!chatGuid) return null;

  if (eventType === 'typing') {
    return inbound(payload, chatGuid, 'typing');
  }
  if (eventType === 'read') {
    return inbound(payload, chatGuid, 'read');
  }
  if (eventType === 'error') {
    return inbound(payload, chatGuid, payload.text ?? 'BlueBubbles error');
  }
  if (eventType !== 'new-message' && eventType !== 'message-update') {
    return null;
  }

  const tapback = tapbackText(payload);
  return inbound(payload, chatGuid, tapback ?? payload.text ?? '', {
    contentType: payload.attachments?.length ? 'image' : 'text',
    attachments: payload.attachments
      ?.filter((item) => item.url)
      .map((item) => ({
        url: item.url!,
        contentType: item.mimeType ?? item.mime_type,
        filename: item.transferName ?? item.transfer_name,
      })),
    replyToId: payload.associatedMessageGuid,
  });
}

function inbound(
  payload: BlueBubblesMessageEvent,
  chatGuid: string,
  content: string,
  overrides?: Partial<InboundMessage>,
): InboundMessage {
  return {
    channelId: 'imessage',
    chatId: chatGuid,
    senderId: payload.handle?.address ?? payload.handle?.uniqueId ?? 'unknown',
    senderName: payload.handle?.address ?? 'iMessage user',
    content,
    contentType: 'text',
    messageId: payload.guid,
    timestamp: payload.dateCreated
      ? new Date(payload.dateCreated).toISOString()
      : new Date().toISOString(),
    raw: payload,
    ...overrides,
  };
}

function tapbackText(payload: BlueBubblesMessageEvent): string | null {
  if (typeof payload.associatedMessageType !== 'number') return null;
  const reaction = TAPBACKS.get(payload.associatedMessageType);
  return reaction ? `reaction_added: ${reaction}` : null;
}
