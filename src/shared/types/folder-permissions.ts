/**
 * Folder Permission Types
 *
 * Cowork-style per-folder permission model with consent dialogs.
 * Non-"alwaysAllow" permissions are reset on app restart for safety.
 */

export interface FolderPermission {
  /** Absolute resolved path */
  path: string;
  /** Last path segment for display */
  displayName: string;
  /** Granular permission levels */
  permissions: { read: boolean; write: boolean; delete: boolean };
  /** If true, read+write persist across restarts (delete NEVER auto-approved) */
  alwaysAllow: boolean;
  /** ISO-8601 timestamp for MRU sorting */
  lastUsed: string;
}

export type PermissionLevel = 'read' | 'write' | 'delete';

export type PermissionDialogResult =
  | { action: 'cancel' }
  | { action: 'allow'; alwaysAllow: boolean };
