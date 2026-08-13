/**
 * Notion Integration Client
 *
 * Provides Notion API operations using the access token obtained
 * through the OAuth2 public integration flow.
 *
 * Uses direct fetch calls against the Notion REST API v1.
 */

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('NotionIntegration');

const NOTION_API_BASE = 'https://api.notion.com/v1';

// ============================================================================
// Types
// ============================================================================

export interface NotionPage {
  id: string;
  object: 'page';
  url: string;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  properties: Record<string, NotionProperty>;
  parent: { type: string; database_id?: string; page_id?: string };
  icon?: { type: string; emoji?: string; external?: { url: string } };
}

export interface NotionDatabase {
  id: string;
  object: 'database';
  title: Array<{ plain_text: string }>;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, { id: string; type: string; name: string }>;
}

export interface NotionBlock {
  id: string;
  object: 'block';
  type: string;
  has_children: boolean;
  [key: string]: unknown;
}

export interface NotionProperty {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface NotionSearchResult {
  results: Array<NotionPage | NotionDatabase>;
  has_more: boolean;
  next_cursor: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

async function notionFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const client = await getConnectionBroker().getServiceClient('notion');

  const res = await client(`${NOTION_API_BASE}${path}`, {
    ...options,
    headers: { ...options.headers },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error(`Notion API error (${path}): ${res.status} ${errorBody}`);
    throw new Error(`Notion API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ============================================================================
// Public API
// ============================================================================

/** Search across all pages and databases the integration has access to */
export async function search(
  query: string,
  filter?: 'page' | 'database',
  pageSize = 10,
  startCursor?: string,
): Promise<NotionSearchResult> {
  const body: Record<string, unknown> = {
    query,
    page_size: pageSize,
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  };

  if (filter) {
    body.filter = { value: filter, property: 'object' };
  }
  if (startCursor) {
    body.start_cursor = startCursor;
  }

  return notionFetch<NotionSearchResult>('/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Get a page by ID */
export async function getPage(pageId: string): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${pageId}`);
}

/** Get the block children (content) of a page or block */
export async function getBlockChildren(
  blockId: string,
  pageSize = 100,
): Promise<{
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}> {
  return notionFetch(`/blocks/${blockId}/children?page_size=${pageSize}`);
}

/** Query a database with optional filters */
export async function queryDatabase(
  databaseId: string,
  filter?: Record<string, unknown>,
  sorts?: Array<{ property: string; direction: 'ascending' | 'descending' }>,
  pageSize = 10,
): Promise<{
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}> {
  const body: Record<string, unknown> = { page_size: pageSize };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;

  return notionFetch(`/databases/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Create a page in a parent page or database */
export async function createPage(
  parentId: string,
  parentType: 'database_id' | 'page_id',
  properties: Record<string, unknown>,
  children?: Array<Record<string, unknown>>,
): Promise<NotionPage> {
  const body: Record<string, unknown> = {
    parent: { [parentType]: parentId },
    properties,
  };
  if (children) body.children = children;

  const page = await notionFetch<NotionPage>('/pages', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  logger.info(`Created Notion page: ${page.id}`);
  return page;
}

/** Append content blocks to a page */
export async function appendBlocks(
  blockId: string,
  children: Array<Record<string, unknown>>,
): Promise<{ results: NotionBlock[] }> {
  return notionFetch(`/blocks/${blockId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children }),
  });
}

/** Extract plain text from a page's block content (convenience) */
export async function getPageText(pageId: string): Promise<string> {
  const { results } = await getBlockChildren(pageId);

  const lines: string[] = [];
  for (const block of results) {
    const blockContent = block[block.type] as
      | { rich_text?: Array<{ plain_text: string }> }
      | undefined;
    if (blockContent?.rich_text) {
      const text = blockContent.rich_text.map((t) => t.plain_text).join('');
      if (text) lines.push(text);
    }
  }

  return lines.join('\n');
}
