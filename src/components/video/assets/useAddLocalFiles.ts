import { type ChangeEvent, useCallback, useRef, useState } from 'react';

import { toast } from 'sonner';

import type { VideoProjectEditorActions } from '../editorTypes';

interface AddLocalFilesLabels {
  attachQueuedToast: string;
  attachSucceededToast: string;
  attachPartialToast: string;
  materializeFailed: string;
}

/**
 * Picks one or more local media files and imports them straight into project
 * assets. We upload the bytes (rather than attach by path) so files from
 * anywhere on disk work — path-attach is confined to the workspace root and
 * would reject them.
 *
 * Files go up one request at a time. A single multipart request carrying every
 * pick is buffered whole in the API process, so selecting a few 4K clips
 * (hundreds of MB each) blew past the server's memory budget and the upload
 * never came back. One request per file also means a bad file fails alone
 * instead of taking the whole selection down with it.
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
      if (files.length > 1) {
        toast.info(
          labels.attachQueuedToast.replace('{count}', String(files.length)),
        );
      }
      let succeeded = 0;
      let firstError: string | null = null;
      try {
        for (const file of files) {
          try {
            await actions.uploadAssets([file]);
            succeeded += 1;
          } catch (error) {
            firstError ??=
              error instanceof Error ? error.message : String(error);
          }
        }
        const failed = files.length - succeeded;
        if (failed === 0) {
          toast.success(
            labels.attachSucceededToast.replace('{count}', String(succeeded)),
          );
        } else if (succeeded === 0) {
          toast.error(
            labels.materializeFailed.replace('{message}', firstError ?? ''),
          );
        } else {
          toast.warning(
            labels.attachPartialToast
              .replace('{succeeded}', String(succeeded))
              .replace('{failed}', String(failed)),
          );
        }
      } finally {
        setAddingFiles(false);
      }
    },
    [
      actions,
      labels.attachPartialToast,
      labels.attachQueuedToast,
      labels.attachSucceededToast,
      labels.materializeFailed,
    ],
  );

  return { fileInputRef, addingFiles, openFilePicker, handleFilesSelected };
}
