/**
 * Google Photos Integration (Picker API)
 *
 * Uses the Google Photos Picker API (launched Sept 2024) for read access.
 * The Library API broad-read scopes (photoslibrary.readonly) were removed
 * March 31, 2025 — the Picker API is the official replacement.
 *
 * Flow:
 *   1. Create a picker session → returns a pickerUri
 *   2. User opens pickerUri in browser, selects photos/videos
 *   3. Poll the session until mediaItemsSet = true
 *   4. List the selected media items
 *
 * Requires scope: photospicker.mediaitems.readonly
 */

import { GOOGLE_PHOTOS_SCOPES } from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PhotosIntegration');

const PICKER_API_BASE = 'https://photospicker.googleapis.com/v1';

/** Required scopes for Photos Picker operations */
export const REQUIRED_SCOPES = GOOGLE_PHOTOS_SCOPES;

// ============================================================================
// Types
// ============================================================================

export interface PickerSession {
  id: string;
  pickerUri: string;
  pollingConfig: {
    pollInterval: string;
    timeoutIn: string;
  };
  expireTime: string;
  mediaItemsSet: boolean;
}

export interface PhotoMediaItem {
  id: string;
  createTime: string;
  type: 'PHOTO' | 'VIDEO';
  mediaFile: {
    mimeType: string;
    filename: string;
    fileSize: string;
    baseUrl: string;
    mediaFileMetadata?: {
      width: number;
      height: number;
      cameraMake?: string;
      cameraModel?: string;
    };
    videoMetadata?: {
      fps: number;
      processingStatus: string;
    };
  };
}

export interface PickerMediaItemsResult {
  mediaItems: PhotoMediaItem[];
  nextPageToken?: string;
}

// ============================================================================
// Helpers
// ============================================================================

async function photosFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(`${PICKER_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error(
      `Photos Picker API error (${path}): ${res.status} ${errorBody}`,
    );
    throw new Error(`Photos Picker API error: ${res.status}`);
  }

  return (await res.json()) as T;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a new picker session.
 * Returns a session with a pickerUri — open this in the user's browser
 * so they can select photos/videos.
 */
export async function createSession(): Promise<PickerSession> {
  const session = await photosFetch<PickerSession>('/sessions', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  logger.info(`Created Photos picker session: ${session.id}`);
  return session;
}

/**
 * Poll a picker session to check if the user has finished selecting media.
 * Returns the updated session. Check `session.mediaItemsSet` to know
 * if selection is complete.
 */
export async function getSession(sessionId: string): Promise<PickerSession> {
  return photosFetch<PickerSession>(`/sessions/${sessionId}`);
}

/**
 * List media items that the user selected in the picker session.
 * Only call this after `session.mediaItemsSet` is true.
 */
export async function listPickedMediaItems(
  sessionId: string,
  pageSize = 25,
  pageToken?: string,
): Promise<PickerMediaItemsResult> {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (pageToken) params.set('pageToken', pageToken);

  params.set('sessionId', sessionId);
  return photosFetch<PickerMediaItemsResult>(`/mediaItems?${params}`);
}

/**
 * Delete a picker session (cleanup after use).
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await photosFetch(`/sessions/${sessionId}`, { method: 'DELETE' });
  logger.info(`Deleted Photos picker session: ${sessionId}`);
}

/**
 * Get the download URL for a media item.
 * Append `=d` to the baseUrl for full-resolution download,
 * or `=w{width}-h{height}` for a resized version.
 */
export function getDownloadUrl(
  item: PhotoMediaItem,
  options?: { width?: number; height?: number },
): string {
  const baseUrl = item.mediaFile.baseUrl;
  if (options?.width && options?.height) {
    return `${baseUrl}=w${options.width}-h${options.height}`;
  }
  return `${baseUrl}=d`;
}

/**
 * High-level convenience: create a session, return the picker URL for the user.
 * The caller should open this URL in the user's browser, then poll
 * with getSession() until mediaItemsSet is true.
 */
export async function startPhotoPicker(): Promise<{
  sessionId: string;
  pickerUrl: string;
  pollIntervalMs: number;
  timeoutMs: number;
}> {
  const session = await createSession();

  const pollIntervalMs = parseDuration(session.pollingConfig.pollInterval);
  const timeoutMs = parseDuration(session.pollingConfig.timeoutIn);

  return {
    sessionId: session.id,
    pickerUrl: session.pickerUri,
    pollIntervalMs,
    timeoutMs,
  };
}

/**
 * Parse a Google API duration string (e.g., "5s", "1800s") to milliseconds.
 */
function parseDuration(duration: string): number {
  const seconds = parseFloat(duration.replace('s', ''));
  return isNaN(seconds) ? 5000 : seconds * 1000;
}
