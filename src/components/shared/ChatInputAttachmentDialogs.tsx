import { AssetCatalogPickerDialog } from '@/components/assets/AssetCatalogPickerDialog';
import type { PermissionDialogResult } from '@/shared/types/folder-permissions';

import { AttachByPathDialog } from './AttachByPathDialog';
import type { AttachmentFilePickerProps } from './AttachmentFilePicker';
import {
  CloudStorageAssetPicker,
  type CloudStoragePickerItem,
} from './CloudStorageAssetPicker';
import { FolderPermissionDialog } from './FolderPermissionDialog';
import type { LocalPathResult } from './useChatInputFiles';

interface ChatInputAttachmentDialogsProps {
  cloudPickerOpen: boolean;
  assetCatalogOpen: boolean;
  attachByPathOpen: boolean;
  dropFolderDialogOpen: boolean;
  pendingDropFolder?: string;
  setCloudPickerOpen: (open: boolean) => void;
  setAssetCatalogOpen: (open: boolean) => void;
  setAttachByPathOpen: (open: boolean) => void;
  onAttachByPath: (paths: string[]) => Promise<LocalPathResult[]>;
  filePicker: AttachmentFilePickerProps;
  uploadLimitMb: number;
  onDropFolderDialogResult: (result: PermissionDialogResult) => void;
  onCloudSelect: (items: CloudStoragePickerItem[]) => void;
  onAssetCatalogSelect: (assetIds: string[]) => Promise<void>;
}

export function ChatInputAttachmentDialogs({
  cloudPickerOpen,
  assetCatalogOpen,
  attachByPathOpen,
  dropFolderDialogOpen,
  pendingDropFolder,
  setCloudPickerOpen,
  setAssetCatalogOpen,
  setAttachByPathOpen,
  onAttachByPath,
  filePicker,
  uploadLimitMb,
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
      <AttachByPathDialog
        open={attachByPathOpen}
        onOpenChange={setAttachByPathOpen}
        onAttach={onAttachByPath}
        filePicker={filePicker}
        uploadLimitMb={uploadLimitMb}
      />
    </>
  );
}
