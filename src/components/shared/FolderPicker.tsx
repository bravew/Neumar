/**
 * FolderPicker — Cowork-style recent folders dropdown with multi-select and permission consent
 *
 * Shows a chip button with a dropdown of recent folders. Selecting a folder
 * toggles it in/out of the selection. New folders trigger FolderPermissionDialog
 * unless already "always allowed".
 */

import { useCallback, useState } from 'react';

import { Check, ChevronDown, FolderOpen, FolderPlus, X } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getSettings,
  saveSettings,
  useSettingsValue,
} from '@/shared/db/settings';
import {
  addOrUpdateFolder,
  extractFolderName,
  getRecentFolders,
  isFolderAlwaysAllowed,
  normalizePath,
} from '@/shared/lib/folder-permissions';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  FolderPermission,
  PermissionDialogResult,
} from '@/shared/types/folder-permissions';

import { FolderPermissionDialog } from './FolderPermissionDialog';

interface FolderPickerProps {
  selectedFolders: string[];
  onFoldersChange: (folders: string[]) => void;
  disabled?: boolean;
}

function isFolderSelected(selectedFolders: string[], path: string): boolean {
  const normalized = normalizePath(path);
  return selectedFolders.some((f) => normalizePath(f) === normalized);
}

function toggleFolder(selectedFolders: string[], path: string): string[] {
  const normalized = normalizePath(path);
  if (selectedFolders.some((f) => normalizePath(f) === normalized)) {
    return selectedFolders.filter((f) => normalizePath(f) !== normalized);
  }
  return [...selectedFolders, path];
}

// ------------------------------------------------------------------
// Shared dropdown items — shows recent folders with toggle checkmarks
// ------------------------------------------------------------------
interface FolderDropdownItemsProps {
  recentFolders: FolderPermission[];
  selectedFolders: string[];
  onRecentSelect: (folder: FolderPermission) => void;
  onChooseFolder: () => void;
  noRecentLabel: string;
  recentLabel: string;
  chooseLabel: string;
}

function FolderDropdownItems({
  recentFolders,
  selectedFolders,
  onRecentSelect,
  onChooseFolder,
  noRecentLabel,
  recentLabel,
  chooseLabel,
}: FolderDropdownItemsProps) {
  return (
    <>
      {recentFolders.length > 0 ? (
        <>
          <DropdownMenuLabel className="text-muted-foreground text-xs font-medium uppercase">
            {recentLabel}
          </DropdownMenuLabel>
          {recentFolders.map((folder) => {
            const selected = isFolderSelected(selectedFolders, folder.path);
            return (
              <DropdownMenuItem
                key={folder.path}
                // Prevent dropdown from closing on toggle
                onSelect={(e) => e.preventDefault()}
                onClick={() => onRecentSelect(folder)}
                className={cn(
                  'cursor-pointer gap-3 py-2',
                  selected && 'bg-accent/50',
                )}
              >
                <FolderOpen className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {folder.displayName}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {folder.path}
                  </div>
                </div>
                {selected && <Check className="text-primary size-4 shrink-0" />}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
        </>
      ) : (
        <div className="text-muted-foreground px-2 py-3 text-center text-sm">
          {noRecentLabel}
        </div>
      )}
      <DropdownMenuItem
        onSelect={onChooseFolder}
        className="cursor-pointer gap-3 py-2.5"
      >
        <FolderPlus className="size-4" />
        <span>{chooseLabel}</span>
      </DropdownMenuItem>
    </>
  );
}

export function FolderPicker({
  selectedFolders,
  onFoldersChange,
  disabled = false,
}: FolderPickerProps) {
  const { t } = useLanguage();
  const settings = useSettingsValue();
  const recentFolders = getRecentFolders(settings.allowedFolders);

  // Permission dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  /**
   * Grant permission, persist to settings, and toggle the folder in the selection.
   */
  const grantAndToggle = useCallback(
    (path: string, alwaysAllow: boolean) => {
      const now = new Date().toISOString();
      const folder: FolderPermission = {
        path,
        displayName: extractFolderName(path),
        permissions: { read: true, write: true, delete: false },
        alwaysAllow,
        lastUsed: now,
      };
      const current = getSettings();
      const updated = {
        ...current,
        allowedFolders: addOrUpdateFolder(current.allowedFolders, folder),
      };
      saveSettings(updated);

      // Toggle: if already selected, deselect; otherwise add
      onFoldersChange(toggleFolder(selectedFolders, path));
    },
    [onFoldersChange, selectedFolders],
  );

  /**
   * Handle selecting a recent folder — toggles selection.
   * If toggling ON and not alwaysAllowed, shows permission dialog.
   */
  const handleRecentSelect = useCallback(
    (folder: FolderPermission) => {
      // If already selected, just deselect (no permission needed)
      if (isFolderSelected(selectedFolders, folder.path)) {
        onFoldersChange(toggleFolder(selectedFolders, folder.path));
        return;
      }
      // Toggling on — need permission check
      if (isFolderAlwaysAllowed(settings.allowedFolders, folder.path)) {
        grantAndToggle(folder.path, true);
      } else {
        setPendingPath(folder.path);
        setDialogOpen(true);
      }
    },
    [settings.allowedFolders, selectedFolders, onFoldersChange, grantAndToggle],
  );

  /**
   * Open native folder dialog. Supports selecting multiple folders.
   */
  const handleChooseFolder = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: true,
        title: t.home.workInFolder,
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        if (typeof path !== 'string') continue;
        if (isFolderAlwaysAllowed(settings.allowedFolders, path)) {
          grantAndToggle(path, true);
        } else {
          setPendingPath(path);
          setDialogOpen(true);
          // Only one dialog at a time — remaining paths would need queueing.
          // For simplicity, handle the first non-allowed one and let user re-pick.
          break;
        }
      }
    } catch {
      // Web fallback: prompt for manual path input
      const path = window.prompt('Enter folder path:');
      if (path?.trim()) {
        const trimmed = path.trim();
        if (isFolderAlwaysAllowed(settings.allowedFolders, trimmed)) {
          grantAndToggle(trimmed, true);
        } else {
          setPendingPath(trimmed);
          setDialogOpen(true);
        }
      }
    }
  }, [t, settings.allowedFolders, grantAndToggle]);

  /**
   * Handle permission dialog result.
   */
  const handleDialogResult = useCallback(
    (result: PermissionDialogResult) => {
      setDialogOpen(false);
      if (result.action === 'allow' && pendingPath) {
        grantAndToggle(pendingPath, result.alwaysAllow);
      }
      setPendingPath(null);
    },
    [pendingPath, grantAndToggle],
  );

  // Shared props for dropdown items
  const dropdownItemProps = {
    recentFolders,
    selectedFolders,
    onRecentSelect: handleRecentSelect,
    onChooseFolder: handleChooseFolder,
    noRecentLabel: t.home.noRecentFolders,
    recentLabel: t.home.recentFolders,
    chooseLabel: t.home.chooseDifferentFolder,
  };

  // Permission dialog
  const permissionDialog = pendingPath ? (
    <FolderPermissionDialog
      open={dialogOpen}
      folderPath={pendingPath}
      onResult={handleDialogResult}
    />
  ) : null;

  const primaryFolder = selectedFolders[0];
  const extraCount = selectedFolders.length - 1;

  // Folders selected — show chip with name + optional "+N" badge
  if (primaryFolder) {
    const folderName = extractFolderName(primaryFolder);
    return (
      <div className="flex items-center gap-1">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            data-folder-picker-trigger
            disabled={disabled}
            className={cn(
              'border-border/50 bg-muted/50 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            aria-label={`${t.home.selectedFolder}: ${folderName}`}
          >
            <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
            <span className="max-w-[160px] truncate" title={primaryFolder}>
              {folderName}
            </span>
            {extraCount > 0 && (
              <span className="text-muted-foreground text-xs">
                {t.home.additionalFoldersCount.replace(
                  '{count}',
                  String(extraCount),
                )}
              </span>
            )}
            <ChevronDown className="text-muted-foreground size-3 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            className="z-50 w-72"
          >
            <FolderDropdownItems {...dropdownItemProps} />
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={() => onFoldersChange([])}
          disabled={disabled}
          className={cn(
            'text-muted-foreground hover:text-foreground shrink-0 transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          aria-label={t.home.removeFolder}
        >
          <X className="size-3.5" />
        </button>

        {permissionDialog}
      </div>
    );
  }

  // No folder selected — show folder button with dropdown
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          data-folder-picker-trigger
          disabled={disabled}
          className={cn(
            'border-border/50 bg-muted/50 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          aria-label={t.home.workInFolder}
        >
          <FolderOpen className="text-muted-foreground size-3.5" />
          <span className="text-muted-foreground">{t.home.selectedFolder}</span>
          <ChevronDown className="text-muted-foreground size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8} className="z-50 w-72">
          <FolderDropdownItems {...dropdownItemProps} />
        </DropdownMenuContent>
      </DropdownMenu>

      {permissionDialog}
    </>
  );
}
