import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { LinkedSourcesPanel } from '../LinkedSourcesPanel';

interface LinkedSourcesDialogProps {
  open: boolean;
  project: VideoProject;
  actions: VideoProjectEditorActions;
  onOpenChange: (open: boolean) => void;
}

// Surfaces the existing linked-sources management UI (cloud connections + local
// folders) from the Assets panel's "Connect cloud" action, instead of forcing
// the user over to the side-rail Sources tab.
export function LinkedSourcesDialog({
  open,
  project,
  actions,
  onOpenChange,
}: LinkedSourcesDialogProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.assetsRail;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{labels.connectCloudTitle}</DialogTitle>
          <DialogDescription>
            {labels.connectCloudDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <LinkedSourcesPanel project={project} actions={actions} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
