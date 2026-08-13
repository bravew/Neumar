/**
 * Google Docs Integration
 *
 * Provides Docs API v1 operations using the user's OAuth tokens.
 * Requires the documents scope, requested incrementally.
 *
 * The Docs API uses a batchUpdate model for mutations.
 * Text positions are character indices within the document body.
 */

import { GOOGLE_DOCS_SCOPES } from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DocsIntegration');

const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

/** Required scopes for Docs operations */
export const REQUIRED_SCOPES = GOOGLE_DOCS_SCOPES;

// ============================================================================
// Types
// ============================================================================

export interface Document {
  documentId: string;
  title: string;
  body: DocumentBody;
  revisionId: string;
  documentStyle: Record<string, unknown>;
}

export interface DocumentBody {
  content: StructuralElement[];
}

export interface StructuralElement {
  startIndex: number;
  endIndex: number;
  paragraph?: Paragraph;
  table?: Record<string, unknown>;
  sectionBreak?: Record<string, unknown>;
}

export interface Paragraph {
  elements: ParagraphElement[];
  paragraphStyle?: {
    namedStyleType?: string;
    headingId?: string;
  };
}

export interface ParagraphElement {
  startIndex: number;
  endIndex: number;
  textRun?: {
    content: string;
    textStyle?: Record<string, unknown>;
  };
  inlineObjectElement?: Record<string, unknown>;
}

export interface BatchUpdateResponse {
  documentId: string;
  replies: Array<Record<string, unknown>>;
  writeControl: { requiredRevisionId: string };
}

// ============================================================================
// Helpers
// ============================================================================

async function docsFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(`${DOCS_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Docs API error (${path}): ${res.status} ${body}`);
    throw new Error(`Docs API error: ${res.status} — ${body}`);
  }

  return res;
}

/** Walk a document body and extract plain text */
function extractBodyText(body: DocumentBody): string {
  const parts: string[] = [];
  for (const element of body.content) {
    if (element.paragraph) {
      for (const pe of element.paragraph.elements) {
        if (pe.textRun?.content) {
          parts.push(pe.textRun.content);
        }
      }
    }
  }
  return parts.join('');
}

// ============================================================================
// Public API — Read
// ============================================================================

/** Get the full document structure (metadata + body) */
export async function getDocument(documentId: string): Promise<Document> {
  const res = await docsFetch(`/${documentId}`);
  return res.json() as Promise<Document>;
}

/** Get just the plain text content of a document */
export async function getDocumentText(documentId: string): Promise<string> {
  const doc = await getDocument(documentId);
  return extractBodyText(doc.body);
}

// ============================================================================
// Public API — Write
// ============================================================================

/** Create a new blank document */
export async function createDocument(title: string): Promise<Document> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(DOCS_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Docs create error: ${res.status} ${body}`);
    throw new Error(`Docs create error: ${res.status} — ${body}`);
  }

  const created = (await res.json()) as Document;
  logger.info(`Created document "${title}" (${created.documentId})`);
  return created;
}

/** Send arbitrary batch update requests to a document */
export async function batchUpdate(
  documentId: string,
  requests: Array<Record<string, unknown>>,
): Promise<BatchUpdateResponse> {
  const res = await docsFetch(`/${documentId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
  return res.json() as Promise<BatchUpdateResponse>;
}

/**
 * Insert text at a specific character index.
 * Index 1 is the start of the document body.
 */
export async function insertText(
  documentId: string,
  text: string,
  index = 1,
): Promise<BatchUpdateResponse> {
  return batchUpdate(documentId, [
    {
      insertText: {
        location: { index },
        text,
      },
    },
  ]);
}

/** Find and replace text throughout the document */
export async function replaceText(
  documentId: string,
  findText: string,
  replaceWith: string,
  matchCase = true,
): Promise<{ occurrencesChanged: number }> {
  const result = await batchUpdate(documentId, [
    {
      replaceAllText: {
        containsText: {
          text: findText,
          matchCase,
        },
        replaceText: replaceWith,
      },
    },
  ]);
  const reply = result.replies[0] as {
    replaceAllText?: { occurrencesChanged: number };
  };
  return {
    occurrencesChanged: reply?.replaceAllText?.occurrencesChanged ?? 0,
  };
}

/** Delete a range of content by start/end character indices */
export async function deleteRange(
  documentId: string,
  startIndex: number,
  endIndex: number,
): Promise<BatchUpdateResponse> {
  return batchUpdate(documentId, [
    {
      deleteContentRange: {
        range: {
          startIndex,
          endIndex,
          segmentId: '',
        },
      },
    },
  ]);
}
