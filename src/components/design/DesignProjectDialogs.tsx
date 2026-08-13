import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignProject } from '@/shared/types/design-mode';

export function DesignProjectDialogs({
  renameProject,
  renameTitle,
  deleteCount,
  onRenameTitleChange,
  onCloseRename,
  onSaveRename,
  onCloseDelete,
  onConfirmDelete,
}: {
  renameProject: DesignProject | null;
  renameTitle: string;
  deleteCount: number;
  onRenameTitleChange: (title: string) => void;
  onCloseRename: () => void;
  onSaveRename: () => Promise<void>;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <Dialog open={Boolean(renameProject)} onOpenChange={onCloseRename}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.design.renameProjectTitle}</DialogTitle>
          </DialogHeader>
          <input
            value={renameTitle}
            onChange={(event) => onRenameTitleChange(event.target.value)}
            className="border-input h-10 rounded-md border px-3"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCloseRename}>
              {t.common.cancel}
            </Button>
            <Button type="button" onClick={() => void onSaveRename()}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteCount > 0} onOpenChange={onCloseDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.design.deleteProjectTitle}</DialogTitle>
            <DialogDescription>
              {t.design.deleteProjectBody.replace(
                '{count}',
                String(deleteCount),
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCloseDelete}>
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmDelete}
            >
              {t.design.deleteProject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
