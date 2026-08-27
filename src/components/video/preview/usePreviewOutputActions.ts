import { useCallback } from 'react';

import { toast } from 'sonner';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoRenderOutput } from '@/shared/types/video';

import { openVideoProjectFolder } from '../openVideoProjectFolder';
import { openRenderedOutput } from './previewOutputActions';

/**
 * Hand the finished file to the OS, or say why that failed.
 *
 * Each of these leaves the app — a system player, Finder, a cancel that has to
 * reach the sidecar — so a silent failure would look like the click did
 * nothing at all.
 */
export function usePreviewOutputActions(
  project: VideoProject,
  selectedOutput: VideoRenderOutput | undefined,
  cancelRender: () => Promise<unknown>,
): {
  handleOpenOutput: () => void;
  handleOpenOutputFolder: () => void;
  handleCancelRender: () => void;
} {
  const { t } = useLanguage();
  const labels = t.video.editor;

  const report = useCallback((prefix: string, err: unknown) => {
    toast.error(
      `${prefix}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }, []);

  const handleOpenOutput = useCallback(() => {
    void openRenderedOutput(project, selectedOutput).catch((err) =>
      report(labels.preview.openOutput, err),
    );
  }, [project, selectedOutput, labels.preview.openOutput, report]);

  const handleOpenOutputFolder = useCallback(() => {
    void openVideoProjectFolder(project.id).catch((err) =>
      report(labels.preview.openOutputFolder, err),
    );
  }, [project.id, labels.preview.openOutputFolder, report]);

  const handleCancelRender = useCallback(() => {
    void cancelRender().catch((err) =>
      report(labels.renderProgress.cancel, err),
    );
  }, [cancelRender, labels.renderProgress.cancel, report]);

  return { handleOpenOutput, handleOpenOutputFolder, handleCancelRender };
}
