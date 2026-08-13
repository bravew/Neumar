import { type ChangeEvent, useCallback, useRef, useState } from 'react';

import { toast } from 'sonner';

import type { VideoProjectEditorActions } from '../editorTypes';

interface AddLocalFilesLabels {
  attachSucceededToast: string;
  materializeFailed: string;
}

/**
 * Picks one or more local media files and imports them straight into project
 * assets. We upload the bytes (rather than attach by path) so files from
 * anywhere on disk work — path-attach is confined to the workspace root and
 * would reject them.
 */
export function useAddLocalFiles(
  actions: VideoProjectEditorActions,
  labels: AddLocalFilesLabels,
): {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addingFiles: boolean;
  openFilePicker: () => void;
  handleFilesSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
} {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [addingFiles, setAddingFiles] = useState(false);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const files = input.files ? Array.from(input.files) : [];
      // Clear the value so re-picking the same file fires `change` again.
      input.value = '';
      if (files.length === 0) return;
      setAddingFiles(true);
      try {
        await actions.uploadAssets(files);
        toast.success(
          labels.attachSucceededToast.replace('{count}', String(files.length)),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(labels.materializeFailed.replace('{message}', message));
      } finally {
        setAddingFiles(false);
      }
    },
    [actions, labels.attachSucceededToast, labels.materializeFailed],
  );

  return { fileInputRef, addingFiles, openFilePicker, handleFilesSelected };
}
