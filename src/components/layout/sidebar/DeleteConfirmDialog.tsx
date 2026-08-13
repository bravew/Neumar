import { useEffect, useState } from 'react';

import { motion } from 'motion/react';

import { DURATION, SPRING } from '@/config/animation';
import type { useLanguage } from '@/shared/providers/language-provider';

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (deleteFolder: boolean) => void;
  folderPath?: string;
  t: ReturnType<typeof useLanguage>['t'];
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  folderPath,
  t,
}: DeleteConfirmDialogProps) {
  const [deleteFolder, setDeleteFolder] = useState(false);

  // Reset checkbox when dialog opens (covers backdrop dismiss not resetting state)
  useEffect(() => {
    if (open) setDeleteFolder(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DURATION.normal }}
      />
      <motion.div
        className="bg-background border-border relative w-[450px] max-w-[90vw] rounded-lg border p-6 shadow-xl"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ ...SPRING.snappy }}
      >
        <h3 className="text-foreground text-lg font-semibold">
          {t.common.deleteTaskConfirm}
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          {t.common.deleteTaskDescription}
        </p>

        {folderPath && (
          <div className="bg-muted/50 mt-4 rounded-lg p-3">
            <div className="text-muted-foreground text-xs font-medium">
              {t.common.sessionFolderPath}
            </div>
            <div className="text-foreground mt-1 font-mono text-xs break-all">
              {folderPath}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            id="delete-folder"
            checked={deleteFolder}
            onChange={(e) => setDeleteFolder(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-red-500 focus:ring-red-500"
          />
          <label htmlFor="delete-folder" className="text-sm">
            <div className="text-foreground font-medium">
              {t.common.deleteSessionFolder}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              {t.common.deleteSessionFolderDescription}
            </div>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => {
              setDeleteFolder(false);
              onOpenChange(false);
            }}
            className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
          >
            {t.common.cancel}
          </button>
          <motion.button
            onClick={() => {
              onConfirm(deleteFolder);
              setDeleteFolder(false);
              onOpenChange(false);
            }}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white transition-colors hover:bg-red-600"
            whileTap={{ scale: 0.97 }}
          >
            {t.common.delete}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
