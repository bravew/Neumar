import { type ChangeEvent, useCallback, useRef, useState } from 'react';

import { toast } from 'sonner';

import { acquireAssetMaterializationLease } from '@/shared/assets/materializationLease';

import type { VideoProjectEditorActions } from '../editorTypes';
import { pickLocalMediaFiles } from './pickLocalMediaFiles';

interface AddLocalFilesLabels {
  attachQueuedToast: string;
  attachSucceededToast: string;
  attachPartialToast: string;
  materializeFailed: string;
}

/**
 * Adds local media to the project.
 *
 * Preferred route: an OS file chooser that yields real paths, so the project
 * references the user's own file and copies nothing. A browser `File` carries
 * bytes but no path, so the hidden `<input type="file">` is the fallback for
 * platforms with no native dialog — and there the bytes must be uploaded.
 *
 * Uploads go one request at a time. A single multipart request carrying every
 * pick is buffered whole in the API process, so selecting a few 4K clips
 * (hundreds of MB each) blew past the server's memory budget and never came
 * back. One request per file also means a bad file fails alone instead of
 * taking the whole selection down with it.
 */
export function useAddLocalFiles(
  actions: VideoProjectEditorActions,
  labels: AddLocalFilesLabels,
  sessionId?: string,
): {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addingFiles: boolean;
  openFilePicker: () => void;
  handleFilesSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
} {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [addingFiles, setAddingFiles] = useState(false);

  const reportOutcome = useCallback(
    (total: number, succeeded: number, firstError: string | null) => {
      const failed = total - succeeded;
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
    },
    [
      labels.attachPartialToast,
      labels.attachSucceededToast,
      labels.materializeFailed,
    ],
  );

  const openFilePicker = useCallback(() => {
    void (async () => {
      setAddingFiles(true);
      let releaseLease = () => {};
      try {
        const paths = await pickLocalMediaFiles();
        if (paths === null) {
          // No native chooser on this platform — upload instead.
          fileInputRef.current?.click();
          return;
        }
        if (paths.length === 0) return;
        // Take the lease only once the chooser has closed: an event stream
        // held open while the OS dialog is up competes for a socket with the
        // very request that raised it.
        releaseLease = acquireAssetMaterializationLease(sessionId);
        await actions.attachAssetPaths(paths, 'reference', sessionId);
        reportOutcome(paths.length, paths.length, null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(labels.materializeFailed.replace('{message}', message));
      } finally {
        releaseLease();
        setAddingFiles(false);
      }
    })();
  }, [actions, labels.materializeFailed, reportOutcome, sessionId]);

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
        reportOutcome(files.length, succeeded, firstError);
      } finally {
        setAddingFiles(false);
      }
    },
    [actions, labels.attachQueuedToast, reportOutcome],
  );

  return { fileInputRef, addingFiles, openFilePicker, handleFilesSelected };
}
