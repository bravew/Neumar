/**
 * Folder Permission Consent Dialog
 *
 * Cowork-style dialog: "Allow {appName} to change files in "{folderName}"?"
 * with Cancel / Always allow / Allow buttons.
 */

import { FolderOpen, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { branding } from '@/config/branding';
import { extractFolderName } from '@/shared/lib/folder-permissions';
import { useLanguage } from '@/shared/providers/language-provider';
import type { PermissionDialogResult } from '@/shared/types/folder-permissions';

interface FolderPermissionDialogProps {
  open: boolean;
  folderPath: string;
  onResult: (result: PermissionDialogResult) => void;
}

export function FolderPermissionDialog({
  open,
  folderPath,
  onResult,
}: FolderPermissionDialogProps) {
  const { t } = useLanguage();
  const folderName = extractFolderName(folderPath);
  const appName = branding.displayName;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onResult({ action: 'cancel' });
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="bg-primary/10 mx-auto mb-3 flex size-12 items-center justify-center rounded-full">
            <FolderOpen className="text-primary size-6" />
          </div>
          <DialogTitle className="text-center">
            {t.home.folderPermission.title
              .replace('{appName}', appName)
              .replace('{folderName}', folderName)}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="mt-2 flex items-start gap-2 text-left text-sm">
              <ShieldAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <span>{t.home.folderPermission.description}</span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/50 border-border/50 rounded-lg border px-3 py-2 text-sm">
          <span
            className="text-muted-foreground block truncate"
            title={folderPath}
          >
            {folderPath}
          </span>
        </div>

        <DialogFooter className="flex-row justify-end gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onResult({ action: 'cancel' })}
          >
            {t.home.folderPermission.cancel}
          </Button>
          <Button
            variant="outline"
            onClick={() => onResult({ action: 'allow', alwaysAllow: true })}
          >
            {t.home.folderPermission.alwaysAllow}
          </Button>
          <Button
            onClick={() => onResult({ action: 'allow', alwaysAllow: false })}
          >
            {t.home.folderPermission.allow}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
