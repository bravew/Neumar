import { AssetCatalogPickerDialog } from '@/components/assets/AssetCatalogPickerDialog';
import type { PermissionDialogResult } from '@/shared/types/folder-permissions';

import {
  CloudStorageAssetPicker,
  type CloudStoragePickerItem,
} from './CloudStorageAssetPicker';
import { FolderPermissionDialog } from './FolderPermissionDialog';

interface ChatInputAttachmentDialogsProps {
  cloudPickerOpen: boolean;
  assetCatalogOpen: boolean;
  dropFolderDialogOpen: boolean;
  pendingDropFolder?: string;
  setCloudPickerOpen: (open: boolean) => void;
  setAssetCatalogOpen: (open: boolean) => void;
  onDropFolderDialogResult: (result: PermissionDialogResult) => void;
  onCloudSelect: (items: CloudStoragePickerItem[]) => void;
  onAssetCatalogSelect: (assetIds: string[]) => Promise<void>;
}

export function ChatInputAttachmentDialogs({
  cloudPickerOpen,
  assetCatalogOpen,
  dropFolderDialogOpen,
  pendingDropFolder,
  setCloudPickerOpen,
  setAssetCatalogOpen,
  onDropFolderDialogResult,
  onCloudSelect,
  onAssetCatalogSelect,
}: ChatInputAttachmentDialogsProps) {
  return (
    <>
      {pendingDropFolder ? (
        <FolderPermissionDialog
          open={dropFolderDialogOpen}
          folderPath={pendingDropFolder}
          onResult={onDropFolderDialogResult}
        />
      ) : null}
      <CloudStorageAssetPicker
        open={cloudPickerOpen}
        onOpenChange={setCloudPickerOpen}
        onSelect={onCloudSelect}
      />
      <AssetCatalogPickerDialog
        open={assetCatalogOpen}
        onOpenChange={setAssetCatalogOpen}
        onAttach={onAssetCatalogSelect}
      />
    </>
  );
}
