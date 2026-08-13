/**
 * LibraryDeleteDialog — Batch delete confirmation modal with folder cleanup option.
 */

import { Loader2, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import type { useLanguage } from '@/shared/providers/language-provider';

interface LibraryDeleteDialogProps {
  open: boolean;
  count: number;
  isDeleting: boolean;
  deleteAlsoFolder: boolean;
  onDeleteAlsoFolderChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  t: ReturnType<typeof useLanguage>['t'];
}

export function LibraryDeleteDialog({
  open,
  count,
  isDeleting,
  deleteAlsoFolder,
  onDeleteAlsoFolderChange,
  onConfirm,
  onCancel,
  t,
}: LibraryDeleteDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isDeleting && onCancel()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="bg-background mx-4 w-full max-w-md rounded-2xl p-6 shadow-xl"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <h3 className="text-foreground mb-2 text-lg font-semibold">
              {t.library.deleteConfirmTitle}
            </h3>
            <p className="text-muted-foreground mb-4 text-sm">
              {t.library.deleteConfirmMessage.replace('{count}', String(count))}
            </p>

            {/* Delete folder option */}
            <label className="mb-5 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={deleteAlsoFolder}
                onChange={(e) => onDeleteAlsoFolderChange(e.target.checked)}
                className="accent-primary size-4 rounded"
              />
              <span className="text-muted-foreground text-sm">
                {t.library.deleteAlsoFolder}
              </span>
            </label>

            <div className="flex justify-end gap-3">
              <button
                onClick={onCancel}
                disabled={isDeleting}
                className="text-muted-foreground hover:bg-muted cursor-pointer rounded-lg px-4 py-2 text-sm transition-colors"
              >
                {t.library.cancel}
              </button>
              <button
                onClick={onConfirm}
                disabled={isDeleting}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t.library.deleting}
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4" />
                    {t.library.deleteConfirmButton}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
