import { Download, ExternalLink, FolderOpen } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoProject,
  VideoRenderOutput,
} from '@/shared/types/video';

import { ExportBlockedNotice } from './ExportBlockedNotice';
import {
  formatBytes,
  formatDuration,
  OutputRenderCard,
} from './OutputRenderCard';

export type PreviewViewMode = 'preview' | 'output';

/**
 * The delivery surface: the file the render produced, at a size you can
 * actually judge, next to the facts that decide whether it ships.
 *
 * This deliberately takes the whole canvas rather than the middle column the
 * timeline preview uses. The asset rail and clip inspector edit the *edit*;
 * once you are checking the rendered file they are noise, and the player is
 * the only thing that benefits from the space.
 */
export function OutputReview({
  project,
  aspect,
  outputs,
  selectedOutput,
  videoSrc,
  posterSrc,
  onAspectChange,
  onOpenOutput,
  onOpenOutputFolder,
}: {
  project: VideoProject;
  aspect: VideoAspectRatio;
  outputs: VideoRenderOutput[];
  selectedOutput?: VideoRenderOutput;
  videoSrc?: string;
  posterSrc?: string;
  onAspectChange: (aspect: VideoAspectRatio) => void;
  onOpenOutput: () => void;
  onOpenOutputFolder: () => void;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.preview;

  // No file yet is the common case on this screen, and the reason is several
  // steps back. Say which one rather than showing an empty player.
  if (!videoSrc) return <ExportBlockedNotice project={project} />;

  const facts: Array<[string, string]> = [];
  if (selectedOutput?.codec)
    facts.push([labels.factCodec, selectedOutput.codec]);
  if (selectedOutput?.durationSec) {
    facts.push([
      labels.factDuration,
      formatDuration(selectedOutput.durationSec),
    ]);
  }
  if (selectedOutput?.fileSize) {
    facts.push([labels.factSize, formatBytes(selectedOutput.fileSize)]);
  }
  if (selectedOutput?.loudnessLufs != null) {
    facts.push([
      labels.factLoudness,
      `${selectedOutput.loudnessLufs.toFixed(1)} LUFS`,
    ]);
  }
  if (selectedOutput?.peakDbfs != null) {
    facts.push([labels.factPeak, `${selectedOutput.peakDbfs.toFixed(1)} dBFS`]);
  }
  if (selectedOutput?.colorManagement?.outputColorSpace) {
    facts.push([
      labels.factColor,
      selectedOutput.colorManagement.outputColorSpace,
    ]);
  }

  return (
    <div className="flex size-full min-h-0 flex-col gap-3 p-3">
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-md bg-black">
        <video
          key={videoSrc}
          controls
          autoPlay={false}
          src={videoSrc}
          poster={posterSrc}
          className="max-h-full max-w-full"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {facts.map(([label, value]) => (
          <span key={label} className="text-[11px]">
            <span className="text-muted-foreground">{label} </span>
            <span className="text-foreground font-medium">{value}</span>
          </span>
        ))}
        <span className="ml-auto flex gap-1">
          <a
            href={videoSrc}
            download
            className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
          >
            <Download className="size-3" />
            {labels.downloadOutput}
          </a>
          <button
            type="button"
            onClick={onOpenOutput}
            className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
          >
            <ExternalLink className="size-3" />
            {labels.openOutput}
          </button>
          <button
            type="button"
            onClick={onOpenOutputFolder}
            className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
          >
            <FolderOpen className="size-3" />
            {labels.openOutputFolder}
          </button>
        </span>
      </div>

      {outputs.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {outputs.map((output) => (
            <OutputRenderCard
              key={output.aspectRatio}
              project={project}
              output={output}
              selected={output.aspectRatio === aspect}
              onSelect={onAspectChange}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
