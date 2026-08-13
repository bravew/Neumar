import { Image, Library, Paperclip, Plus } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';

interface ChatInputAttachmentMenuProps {
  isHome: boolean;
  disabled: boolean;
  openFilePicker: () => void;
  openCloudStoragePicker: () => void;
  openAssetCatalogPicker: () => void;
  addFilesLabel: string;
  addCloudStorageLabel: string;
  addAssetCatalogLabel: string;
  allowCloudStorage?: boolean;
  allowAssetCatalog?: boolean;
}

export function ChatInputAttachmentMenu({
  isHome,
  disabled,
  openFilePicker,
  openCloudStoragePicker,
  openAssetCatalogPicker,
  addFilesLabel,
  addCloudStorageLabel,
  addAssetCatalogLabel,
  allowCloudStorage = true,
  allowAssetCatalog = true,
}: ChatInputAttachmentMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          'flex items-center justify-center transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          isHome
            ? 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground size-8 rounded-full border'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground size-7 rounded-md',
        )}
      >
        <Plus className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="z-50 w-56">
        <DropdownMenuItem
          onSelect={openFilePicker}
          className="cursor-pointer gap-3 py-2.5"
        >
          <Paperclip className="size-4" />
          <span>{addFilesLabel}</span>
        </DropdownMenuItem>
        {allowCloudStorage ? (
          <DropdownMenuItem
            onSelect={openCloudStoragePicker}
            className="cursor-pointer gap-3 py-2.5"
          >
            <Image className="size-4" />
            <span>{addCloudStorageLabel}</span>
          </DropdownMenuItem>
        ) : null}
        {allowAssetCatalog ? (
          <DropdownMenuItem
            onSelect={openAssetCatalogPicker}
            className="cursor-pointer gap-3 py-2.5"
          >
            <Library className="size-4" />
            <span>{addAssetCatalogLabel}</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
