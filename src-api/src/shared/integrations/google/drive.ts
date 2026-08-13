/**
 * Google Drive Integration
 *
 * Provides Drive API operations using the user's OAuth tokens.
 * Requires the drive.readonly and/or drive.file scopes.
 */

import { GOOGLE_DRIVE_SCOPES } from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DriveIntegration');

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

/** Google Drive IDs contain only alphanumeric chars, hyphens, and underscores */
const DRIVE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Required scopes for Drive operations */
export const REQUIRED_SCOPES = GOOGLE_DRIVE_SCOPES;

// ============================================================================
// Types
// ============================================================================

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
  owners?: Array<{ displayName: string; emailAddress: string }>;
  shared: boolean;
}

export interface DriveSearchResult {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface DriveComment {
  id: string;
  content: string;
  author: { displayName: string; emailAddress?: string };
  createdTime: string;
  modifiedTime: string;
  resolved: boolean;
  replies?: Array<{
    id: string;
    content: string;
    author: { displayName: string; emailAddress?: string };
    createdTime: string;
  }>;
}

export interface DrivePermission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  displayName?: string;
}

export interface DriveRevision {
  id: string;
  mimeType: string;
  modifiedTime: string;
  lastModifyingUser?: { displayName: string; emailAddress?: string };
  size?: string;
}

// ============================================================================
// Helpers
// ============================================================================

const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

async function driveFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(`${DRIVE_API_BASE}${path}`, {
    ...options,
    headers: { ...options.headers },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Drive API error (${path}): ${res.status} ${body}`);
    throw new Error(`Drive API error: ${res.status} — ${body}`);
  }

  return res;
}

async function driveUploadFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(`${DRIVE_UPLOAD_BASE}${path}`, {
    ...options,
    headers: { ...options.headers },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Drive upload API error (${path}): ${res.status} ${body}`);
    throw new Error(`Drive upload API error: ${res.status} — ${body}`);
  }

  return res;
}

// Standard fields to request for file metadata
const FILE_FIELDS =
  'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,parents,owners,shared';

// ============================================================================
// Public API
// ============================================================================

/** List files and folders, optionally in a specific folder */
export async function listFiles(
  folderId?: string,
  maxResults = 20,
  pageToken?: string,
): Promise<DriveSearchResult> {
  const params = new URLSearchParams({
    pageSize: String(maxResults),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    orderBy: 'modifiedTime desc',
  });

  if (folderId) {
    if (!DRIVE_ID_PATTERN.test(folderId)) {
      throw new Error('Invalid folder ID format');
    }
    params.set('q', `'${folderId}' in parents and trashed = false`);
  } else {
    params.set('q', 'trashed = false');
  }

  if (pageToken) params.set('pageToken', pageToken);

  const res = await driveFetch(`/files?${params}`);
  const data = await res.json();
  return {
    files: data.files ?? [],
    nextPageToken: data.nextPageToken,
  };
}

/** Search files by name or content */
export async function searchFiles(
  query: string,
  maxResults = 10,
): Promise<DriveSearchResult> {
  const sanitizedQuery = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const params = new URLSearchParams({
    pageSize: String(maxResults),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    q: `fullText contains '${sanitizedQuery}' and trashed = false`,
    orderBy: 'modifiedTime desc',
  });

  const res = await driveFetch(`/files?${params}`);
  const data = await res.json();
  return {
    files: data.files ?? [],
    nextPageToken: data.nextPageToken,
  };
}

/** Get a file's metadata by ID */
export async function getFile(fileId: string): Promise<DriveFile | null> {
  try {
    const params = new URLSearchParams({ fields: FILE_FIELDS });
    const res = await driveFetch(`/files/${fileId}?${params}`);
    return res.json();
  } catch {
    return null;
  }
}

/** Download a file's content as text (for Google Docs, Sheets export) */
export async function downloadFileContent(
  fileId: string,
  mimeType?: string,
): Promise<string> {
  let path: string;

  if (mimeType) {
    // Export Google Workspace file to a specific format
    const params = new URLSearchParams({ mimeType });
    path = `/files/${fileId}/export?${params}`;
  } else {
    // Download binary file
    const params = new URLSearchParams({ alt: 'media' });
    path = `/files/${fileId}?${params}`;
  }

  const res = await driveFetch(path);
  return res.text();
}

/** Get recent files (last 7 days modified) */
export async function getRecentFiles(maxResults = 10): Promise<DriveFile[]> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const params = new URLSearchParams({
    pageSize: String(maxResults),
    fields: `files(${FILE_FIELDS})`,
    q: `modifiedTime > '${weekAgo.toISOString()}' and trashed = false`,
    orderBy: 'modifiedTime desc',
  });

  const res = await driveFetch(`/files?${params}`);
  const data = await res.json();
  logger.debug(`Found ${data.files?.length ?? 0} recent files`);
  return data.files ?? [];
}

// ============================================================================
// File CRUD
// ============================================================================

/** Create a file (metadata-only or with content) */
export async function createFile(
  name: string,
  mimeType: string,
  parentId?: string,
  content?: string,
): Promise<DriveFile> {
  const metadata: Record<string, unknown> = { name, mimeType };
  if (parentId) metadata.parents = [parentId];

  if (content) {
    // Multipart upload with content
    const boundary = '===drive_boundary===';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await driveUploadFetch(
      `/files?uploadType=multipart&fields=${FILE_FIELDS}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    return res.json();
  }

  // Metadata-only creation
  const res = await driveFetch(`/files?fields=${FILE_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) {
    throw new Error(`Failed to create file: ${res.status}`);
  }
  logger.info(`Created file: ${name}`);
  return res.json();
}

/** Create a folder */
export async function createFolder(
  name: string,
  parentId?: string,
): Promise<DriveFile> {
  return createFile(name, 'application/vnd.google-apps.folder', parentId);
}

/** Update file metadata (name, description, starred) */
export async function updateFileMetadata(
  fileId: string,
  metadata: { name?: string; description?: string; starred?: boolean },
): Promise<DriveFile> {
  const res = await driveFetch(`/files/${fileId}?fields=${FILE_FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  return res.json();
}

/** Copy a file */
export async function copyFile(
  fileId: string,
  name?: string,
  parentId?: string,
): Promise<DriveFile> {
  const body: Record<string, unknown> = {};
  if (name) body.name = name;
  if (parentId) body.parents = [parentId];

  const res = await driveFetch(`/files/${fileId}/copy?fields=${FILE_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  logger.info(`Copied file ${fileId}`);
  return res.json();
}

/** Move file to trash */
export async function trashFile(fileId: string): Promise<DriveFile> {
  const res = await driveFetch(`/files/${fileId}?fields=${FILE_FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  logger.info(`Trashed file ${fileId}`);
  return res.json();
}

/** Restore file from trash */
export async function untrashFile(fileId: string): Promise<DriveFile> {
  const res = await driveFetch(`/files/${fileId}?fields=${FILE_FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: false }),
  });
  return res.json();
}

// ============================================================================
// Move
// ============================================================================

/** Move a file to a different folder */
export async function moveFile(
  fileId: string,
  newParentId: string,
  oldParentId?: string,
): Promise<DriveFile> {
  const params = new URLSearchParams({
    addParents: newParentId,
    fields: FILE_FIELDS,
  });
  if (oldParentId) params.set('removeParents', oldParentId);

  const res = await driveFetch(`/files/${fileId}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  logger.info(`Moved file ${fileId} to folder ${newParentId}`);
  return res.json();
}

// ============================================================================
// Export / Upload
// ============================================================================

/** Export a Google Workspace file to a specific MIME type */
export async function exportFile(
  fileId: string,
  mimeType: string,
): Promise<string> {
  const params = new URLSearchParams({ mimeType });
  const res = await driveFetch(`/files/${fileId}/export?${params}`);
  return res.text();
}

/** Upload file content via multipart upload */
export async function uploadFileContent(
  name: string,
  content: string,
  mimeType: string,
  parentId?: string,
): Promise<DriveFile> {
  return createFile(name, mimeType, parentId, content);
}

// ============================================================================
// Comments
// ============================================================================

/** List comments on a file */
export async function listComments(
  fileId: string,
  maxResults = 20,
): Promise<DriveComment[]> {
  const params = new URLSearchParams({
    pageSize: String(maxResults),
    fields: '*',
  });
  const res = await driveFetch(`/files/${fileId}/comments?${params}`);
  const data = await res.json();
  return data.comments ?? [];
}

/** Create a comment on a file */
export async function createComment(
  fileId: string,
  content: string,
): Promise<DriveComment> {
  const res = await driveFetch(`/files/${fileId}/comments?fields=*`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  logger.info(`Created comment on file ${fileId}`);
  return res.json();
}

/** Reply to a comment */
export async function replyToComment(
  fileId: string,
  commentId: string,
  content: string,
): Promise<{ id: string; content: string; createdTime: string }> {
  const res = await driveFetch(
    `/files/${fileId}/comments/${commentId}/replies?fields=*`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
  return res.json();
}

/** Resolve a comment by posting a resolve action reply */
export async function resolveComment(
  fileId: string,
  commentId: string,
): Promise<{ id: string; content: string; createdTime: string }> {
  const res = await driveFetch(
    `/files/${fileId}/comments/${commentId}/replies?fields=*`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Resolved', action: 'resolve' }),
    },
  );
  logger.info(`Resolved comment ${commentId} on file ${fileId}`);
  return res.json();
}

// ============================================================================
// Permissions
// ============================================================================

/** List permissions on a file */
export async function listPermissions(
  fileId: string,
): Promise<DrivePermission[]> {
  const res = await driveFetch(
    `/files/${fileId}/permissions?fields=permissions(id,type,role,emailAddress,displayName)`,
  );
  const data = await res.json();
  return data.permissions ?? [];
}

/** Share a file with a user, group, domain, or anyone */
export async function shareFile(
  fileId: string,
  type: string,
  role: string,
  emailAddress?: string,
  domain?: string,
): Promise<DrivePermission> {
  const permission: Record<string, string> = { type, role };
  if (emailAddress) permission.emailAddress = emailAddress;
  if (domain) permission.domain = domain;

  const res = await driveFetch(
    `/files/${fileId}/permissions?fields=id,type,role,emailAddress,displayName`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(permission),
    },
  );
  logger.info(
    `Shared file ${fileId} with ${type}:${emailAddress ?? domain ?? 'anyone'}`,
  );
  return res.json();
}

/** Update a permission's role */
export async function updatePermission(
  fileId: string,
  permissionId: string,
  role: string,
): Promise<DrivePermission> {
  const res = await driveFetch(
    `/files/${fileId}/permissions/${permissionId}?fields=id,type,role,emailAddress,displayName`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    },
  );
  return res.json();
}

/** Remove a permission from a file */
export async function removePermission(
  fileId: string,
  permissionId: string,
): Promise<void> {
  const _res = await driveFetch(
    `/files/${fileId}/permissions/${permissionId}`,
    {
      method: 'DELETE',
    },
  );
  logger.info(`Removed permission ${permissionId} from file ${fileId}`);
}

// ============================================================================
// Revisions
// ============================================================================

/** List revisions of a file */
export async function listRevisions(fileId: string): Promise<DriveRevision[]> {
  const res = await driveFetch(
    `/files/${fileId}/revisions?fields=revisions(id,mimeType,modifiedTime,lastModifyingUser,size)`,
  );
  const data = await res.json();
  return data.revisions ?? [];
}
