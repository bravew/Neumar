import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { formatCloudStorageAttribution } from '@/components/library/cloudStorageAttribution';
import { API_BASE_URL } from '@/config';
import type { AttachmentSourceContext } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';

import type { CloudStoragePickerItem } from './CloudStorageAssetPicker';

interface UseCloudStorageAttachmentOptions {
  addFiles: (
    files: File[] | FileList,
    forceImage?: boolean,
    sourceContexts?: AttachmentSourceContext[],
  ) => Promise<void>;
  setValue: Dispatch<SetStateAction<string>>;
}

export function useCloudStorageAttachment({
  addFiles,
  setValue,
}: UseCloudStorageAttachmentOptions) {
  const { t, tt } = useLanguage();
  const [cloudPickerOpen, setCloudPickerOpen] = useState(false);

  const handleCloudStorageSelect = useCallback(
    async (selection: CloudStoragePickerItem[]) => {
      const items = await expandFolderSelections(selection);
      const files: File[] = [];
      const sourceContexts: AttachmentSourceContext[] = [];
      const attributions: string[] = [];

      for (const {
        connectionId,
        connectionProvider,
        connectionLabel,
        item,
      } of items) {
        const res = await fetch(
          `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
            connectionId,
          )}/items/${encodeURIComponent(item.id)}/content`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        files.push(
          new File([blob], item.name, {
            type: item.mimeType || blob.type || 'application/octet-stream',
          }),
        );
        sourceContexts.push({
          kind: 'cloud-storage',
          connectionId,
          connectionProvider,
          connectionLabel,
          providerItemId: item.id,
          providerItemName: item.name,
          providerItemPath: item.path,
        });

        const attribution = formatCloudStorageAttribution(
          item.licenseInfo,
          t,
          tt,
        );
        if (attribution) attributions.push(attribution);
      }

      if (files.length > 0) {
        await addFiles(
          files,
          files.every((file) => file.type.startsWith('image/')),
          sourceContexts,
        );
      }

      if (attributions.length > 0) {
        const attributionText = [...new Set(attributions)].join('\n');
        setValue((prev) =>
          prev.trim()
            ? `${prev.trimEnd()}\n\n${attributionText}`
            : attributionText,
        );
      }
    },
    [addFiles, setValue, t, tt],
  );

  return {
    cloudPickerOpen,
    setCloudPickerOpen,
    handleCloudStorageSelect,
  };
}

async function expandFolderSelections(
  selection: CloudStoragePickerItem[],
): Promise<CloudStoragePickerItem[]> {
  const expanded: CloudStoragePickerItem[] = [];
  for (const entry of selection) {
    if (!entry.item.isFolder) {
      expanded.push(entry);
      continue;
    }

    const children = await fetchFolderChildren(entry);
    expanded.push(
      ...children
        .filter((item) => !item.isFolder)
        .map((item) => ({
          connectionId: entry.connectionId,
          connectionProvider: entry.connectionProvider,
          connectionLabel: entry.connectionLabel,
          item,
        })),
    );
  }
  return expanded;
}

async function fetchFolderChildren({
  connectionId,
  item,
}: CloudStoragePickerItem): Promise<CloudStoragePickerItem['item'][]> {
  const children: CloudStoragePickerItem['item'][] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({
      parentId: item.id,
      limit: '100',
    });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(
      `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
        connectionId,
      )}/items?${params}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      items?: CloudStoragePickerItem['item'][];
      nextCursor?: string;
      hasMore?: boolean;
    };
    children.push(...(body.items ?? []));
    cursor = body.hasMore ? body.nextCursor : undefined;
  } while (cursor);
  return children;
}
