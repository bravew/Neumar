/**
 * Google Sheets Integration
 *
 * Provides Sheets API v4 operations using the user's OAuth tokens.
 * Requires the spreadsheets scope, requested incrementally.
 */

import { GOOGLE_SHEETS_SCOPES } from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SheetsIntegration');

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Required scopes for Sheets operations */
export const REQUIRED_SCOPES = GOOGLE_SHEETS_SCOPES;

// ============================================================================
// Types
// ============================================================================

export interface Spreadsheet {
  spreadsheetId: string;
  properties: {
    title: string;
    locale: string;
    timeZone: string;
  };
  sheets: SheetProperties[];
  spreadsheetUrl: string;
}

export interface SheetProperties {
  properties: {
    sheetId: number;
    title: string;
    index: number;
    sheetType: string;
    gridProperties?: { rowCount: number; columnCount: number };
  };
}

export interface ValueRange {
  range: string;
  majorDimension: 'ROWS' | 'COLUMNS';
  values: string[][];
}

// ============================================================================
// Helpers
// ============================================================================

async function sheetsFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(`${SHEETS_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Sheets API error (${path}): ${res.status} ${body}`);
    throw new Error(`Sheets API error: ${res.status} — ${body}`);
  }

  return res;
}

// ============================================================================
// Public API
// ============================================================================

/** Get spreadsheet metadata (sheets list, properties) */
export async function getSpreadsheet(
  spreadsheetId: string,
): Promise<Spreadsheet> {
  const res = await sheetsFetch(`/${spreadsheetId}`);
  return res.json() as Promise<Spreadsheet>;
}

/** Read cell values from a range (A1 notation, e.g. "Sheet1!A1:D10") */
export async function getValues(
  spreadsheetId: string,
  range: string,
): Promise<ValueRange> {
  const encoded = encodeURIComponent(range);
  const res = await sheetsFetch(
    `/${spreadsheetId}/values/${encoded}?valueRenderOption=FORMATTED_VALUE`,
  );
  return res.json() as Promise<ValueRange>;
}

/** Read multiple ranges in a single call */
export async function batchGetValues(
  spreadsheetId: string,
  ranges: string[],
): Promise<ValueRange[]> {
  const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const res = await sheetsFetch(
    `/${spreadsheetId}/values:batchGet?${params}&valueRenderOption=FORMATTED_VALUE`,
  );
  const data = await res.json();
  return (data.valueRanges as ValueRange[]) ?? [];
}

/**
 * Update cell values in a range.
 * Values is a 2D array (rows × columns).
 */
export async function updateValues(
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<{ updatedCells: number; updatedRange: string }> {
  const encoded = encodeURIComponent(range);
  const res = await sheetsFetch(
    `/${spreadsheetId}/values/${encoded}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      body: JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values,
      }),
    },
  );
  const data = await res.json();
  return {
    updatedCells: data.updatedCells,
    updatedRange: data.updatedRange,
  };
}

/** Append rows to a range */
export async function appendValues(
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<{ updatedCells: number; updatedRange: string }> {
  const encoded = encodeURIComponent(range);
  const res = await sheetsFetch(
    `/${spreadsheetId}/values/${encoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values,
      }),
    },
  );
  const data = await res.json();
  const updates = data.updates ?? {};
  return {
    updatedCells: updates.updatedCells ?? 0,
    updatedRange: updates.updatedRange ?? range,
  };
}

/** Create a new spreadsheet */
export async function createSpreadsheet(title: string): Promise<Spreadsheet> {
  // Sheets API create endpoint is at the base (no spreadsheetId)
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(SHEETS_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Sheets create error: ${res.status} ${body}`);
    throw new Error(`Sheets create error: ${res.status} — ${body}`);
  }

  const created = (await res.json()) as Spreadsheet;
  logger.info(`Created spreadsheet "${title}" (${created.spreadsheetId})`);
  return created;
}

/** Add a new sheet tab to an existing spreadsheet */
export async function addSheet(
  spreadsheetId: string,
  title: string,
): Promise<SheetProperties> {
  const res = await sheetsFetch(`/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: { title },
          },
        },
      ],
    }),
  });
  const data = await res.json();
  return data.replies?.[0]?.addSheet as SheetProperties;
}
