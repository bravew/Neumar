/**
 * Gmail Integration
 *
 * Provides Gmail API operations using the user's OAuth tokens.
 * Requires the gmail.readonly and/or gmail.compose scopes.
 *
 * All methods fetch a valid access token from the token manager,
 * refreshing automatically when expired.
 */

import { GOOGLE_GMAIL_SCOPES } from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('GmailIntegration');

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

/** Required scopes for Gmail operations */
export const REQUIRED_SCOPES = GOOGLE_GMAIL_SCOPES;

// ============================================================================
// Types
// ============================================================================

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body?: string;
  labels: string[];
}

export interface GmailThread {
  id: string;
  snippet: string;
  messageCount: number;
}

export interface GmailSearchResult {
  messages: GmailMessage[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

// ============================================================================
// Helpers
// ============================================================================

async function gmailFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  return client(`${GMAIL_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function extractHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ''
  );
}

// ============================================================================
// Public API
// ============================================================================

/** List recent messages from the inbox */
export async function listMessages(
  maxResults = 20,
  query?: string,
  pageToken?: string,
): Promise<GmailSearchResult> {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) params.set('q', query);
  if (pageToken) params.set('pageToken', pageToken);

  const res = await gmailFetch(`/users/me/messages?${params}`);
  if (!res.ok) {
    throw new Error(`Gmail API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const messageIds: Array<{ id: string; threadId: string }> =
    data.messages ?? [];

  // Fetch full message details in parallel (batch of 10)
  const messages: GmailMessage[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const batch = messageIds.slice(i, i + BATCH_SIZE);
    const details = await Promise.all(batch.map((m) => getMessage(m.id)));
    messages.push(...details.filter((d): d is GmailMessage => d !== null));
  }

  return {
    messages,
    nextPageToken: data.nextPageToken,
    resultSizeEstimate: data.resultSizeEstimate ?? 0,
  };
}

/** Get a single message by ID */
export async function getMessage(
  messageId: string,
): Promise<GmailMessage | null> {
  try {
    const res = await gmailFetch(`/users/me/messages/${messageId}?format=full`);
    if (!res.ok) return null;

    const data = await res.json();
    const headers = data.payload?.headers ?? [];

    let body = '';
    if (data.payload?.body?.data) {
      body = decodeBase64Url(data.payload.body.data);
    } else if (data.payload?.parts) {
      const textPart = data.payload.parts.find(
        (p: { mimeType: string }) => p.mimeType === 'text/plain',
      );
      if (textPart?.body?.data) {
        body = decodeBase64Url(textPart.body.data);
      }
    }

    return {
      id: data.id,
      threadId: data.threadId,
      snippet: data.snippet ?? '',
      subject: extractHeader(headers, 'Subject'),
      from: extractHeader(headers, 'From'),
      to: extractHeader(headers, 'To'),
      date: extractHeader(headers, 'Date'),
      body,
      labels: data.labelIds ?? [],
    };
  } catch (err) {
    logger.error(`Failed to fetch message ${messageId}:`, err);
    return null;
  }
}

/** Search messages using Gmail query syntax */
export async function searchMessages(
  query: string,
  maxResults = 10,
): Promise<GmailSearchResult> {
  return listMessages(maxResults, query);
}

/**
 * Strip CR/LF characters to prevent RFC 2822 header injection.
 * Newlines in header values would allow an attacker to insert arbitrary headers.
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Send an email */
export async function sendMessage(
  to: string,
  subject: string,
  body: string,
): Promise<{ id: string; threadId: string }> {
  if (!EMAIL_PATTERN.test(to)) {
    throw new Error('Invalid email address format');
  }

  // Sanitize body to prevent MIME boundary injection in the single-part message.
  // Since Content-Type is text/plain (no multipart boundary), stripping bare CR
  // is sufficient to prevent header re-injection after the blank-line separator.
  const sanitizedBody = body.replace(/\r(?!\n)/g, '');

  const rawMessage = [
    `To: ${sanitizeHeaderValue(to)}`,
    `Subject: ${sanitizeHeaderValue(subject)}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    sanitizedBody,
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmailFetch('/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: encodedMessage }),
  });

  if (!res.ok) {
    throw new Error(`Failed to send email: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  logger.info(`Email sent: ${data.id}`);
  return { id: data.id, threadId: data.threadId };
}

/** Get unread message count */
export async function getUnreadCount(): Promise<number> {
  const res = await gmailFetch('/users/me/labels/INBOX');
  if (!res.ok) return 0;
  const data = await res.json();
  return data.messagesUnread ?? 0;
}
