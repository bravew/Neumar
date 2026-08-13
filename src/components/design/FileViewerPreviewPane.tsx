import type {
  InspectStylePatch,
  NeumaTargetPayload,
} from '@/components/artifacts/live/iframe-sandbox';
import type { PaletteBridgeRequest } from '@/components/artifacts/live/palette-bridge';
import type {
  DesignCommentAttachment,
  DesignLintFinding,
  DrawStroke,
} from '@/shared/types/design-mode';

import type { DeviceViewportId } from './DevicePicker';
import type { FileViewerPreviewLabels } from './file-viewer-labels';
import { MediaPreview, type FileKind } from './file-viewer-utils';
import { FileViewerSourceEditor } from './FileViewerSourceEditor';
import { FileViewerTargetCard } from './FileViewerTargetCard';
import { HtmlPreviewFrame } from './HtmlPreviewFrame';
import { LintPanel } from './LintPanel';
import { PreviewDrawOverlay } from './PreviewDrawOverlay';
import type { PreviewMode } from './PreviewModeSegments';
import { SketchEditor } from './SketchEditor';
import { SketchPreview } from './SketchPreview';

interface FileViewerPreviewPaneProps {
  projectId: string;
  path: string;
  fileKind: FileKind;
  isText: boolean;
  isHtml: boolean;
  isMedia: boolean;
  isSketch: boolean;
  htmlPreviewPath: string | null;
  htmlPreviewContent?: string;
  modulePreviewEntryPath?: string;
  effectiveMode: PreviewMode;
  sketchScreenId: string;
  content: string;
  sourceSaving: boolean;
  sourceCopied: boolean;
  lintFindings: DesignLintFinding[];
  zoom: number;
  deviceViewport: DeviceViewportId;
  inspectPatch: InspectStylePatch | null;
  paletteBridge?: string;
  paletteRequest: PaletteBridgeRequest | null;
  target: NeumaTargetPayload | null;
  targetText: string;
  commentSaving: boolean;
  labels: FileViewerPreviewLabels;
  onContentChange: (content: string) => void;
  onCopy: () => void;
  onSave: () => void;
  onDirtySketchChange: (dirty: boolean) => void;
  onTarget: (target: NeumaTargetPayload) => void;
  onTargets?: (targets: NeumaTargetPayload[]) => void;
  onFrameRef?: (node: HTMLIFrameElement | null) => void;
  onDrawCanvasRef?: (canvas: HTMLCanvasElement | null) => void;
  onTargetTextChange: (text: string) => void;
  onTargetClose: () => void;
  onCommentSubmit: (
    attachToChat: boolean,
    attachments: DesignCommentAttachment[],
  ) => void | Promise<void>;
  onDrawSubmit: (
    strokes: DrawStroke[],
    viewport: { width: number; height: number; scale: number },
  ) => Promise<void>;
}

export function FileViewerPreviewPane({
  projectId,
  path,
  fileKind,
  isText,
  isHtml,
  isMedia,
  isSketch,
  htmlPreviewPath,
  htmlPreviewContent,
  modulePreviewEntryPath,
  effectiveMode,
  sketchScreenId,
  content,
  sourceSaving,
  sourceCopied,
  lintFindings,
  zoom,
  deviceViewport,
  inspectPatch,
  paletteBridge,
  paletteRequest,
  target,
  targetText,
  commentSaving,
  labels,
  onContentChange,
  onCopy,
  onSave,
  onDirtySketchChange,
  onTarget,
  onTargets,
  onFrameRef,
  onDrawCanvasRef,
  onTargetTextChange,
  onTargetClose,
  onCommentSubmit,
  onDrawSubmit,
}: FileViewerPreviewPaneProps) {
  const hasHtmlPreview = Boolean(htmlPreviewPath);
  const showHtmlPreview =
    hasHtmlPreview &&
    (effectiveMode === 'preview' ||
      effectiveMode === 'inspect' ||
      effectiveMode === 'comment' ||
      effectiveMode === 'edit' ||
      effectiveMode === 'draw');

  if (effectiveMode === 'draw' && !isHtml) {
    return (
      <SketchEditor
        projectId={projectId}
        screenId={sketchScreenId}
        onDirtyChange={onDirtySketchChange}
      />
    );
  }

  if (hasHtmlPreview) {
    const previewContent = htmlPreviewContent ?? content;
    const frameMode = showHtmlPreview ? effectiveMode : 'preview';
    const showSource = isText && effectiveMode === 'source';
    const previewHidden = showSource || !showHtmlPreview;
    const sourceHidden = !showSource;
    return (
      <div className="mx-auto flex h-full min-w-0 flex-col">
        {isText && (
          <div
            data-testid="file-viewer-source-pane"
            className="min-h-0 flex-1"
            style={{ display: sourceHidden ? 'none' : undefined }}
          >
            <FileViewerSourceEditor
              content={content}
              saving={sourceSaving}
              sourceCopied={sourceCopied}
              lintFindings={lintFindings}
              labels={{
                copy: labels.copy,
                copied: labels.copied,
                save: labels.save,
                saving: labels.saving,
              }}
              onContentChange={onContentChange}
              onCopy={onCopy}
              onSave={onSave}
            />
          </div>
        )}
        <div
          className="min-h-0 flex-1"
          style={{ display: previewHidden ? 'none' : undefined }}
        >
          {modulePreviewEntryPath && (
            <p className="text-muted-foreground mb-2 rounded-md border px-3 py-2 text-xs">
              {labels.jsxModuleNotice.replace(
                '{entry}',
                modulePreviewEntryPath,
              )}
            </p>
          )}
          <HtmlPreviewFrame
            html={previewContent}
            identity={`${projectId}:${htmlPreviewPath}`}
            mode={frameMode}
            zoom={zoom}
            viewport={deviceViewport}
            inspectPatch={inspectPatch}
            paletteBridge={paletteBridge}
            paletteRequest={paletteRequest}
            fitLabel={labels.fitLabel}
            onTarget={onTarget}
            onTargets={onTargets}
            onFrameRef={onFrameRef}
            renderFullDocument
          >
            {effectiveMode === 'draw' && (
              <PreviewDrawOverlay
                labels={{
                  clear: labels.drawClear,
                  sendToChat: labels.sendToChat,
                  strokeCount: labels.drawStrokeCount,
                }}
                onSubmit={onDrawSubmit}
                onCanvasRef={onDrawCanvasRef}
              />
            )}
          </HtmlPreviewFrame>
          <LintPanel findings={lintFindings} />
          {effectiveMode === 'comment' && target && (
            <FileViewerTargetCard
              target={target}
              filePath={path}
              mode={effectiveMode}
              text={targetText}
              saving={commentSaving}
              labels={labels}
              onTextChange={onTargetTextChange}
              onClose={onTargetClose}
              onSubmitEdit={() => {}}
              onSubmitComment={onCommentSubmit}
            />
          )}
        </div>
      </div>
    );
  }

  if (isText && effectiveMode === 'source') {
    return (
      <FileViewerSourceEditor
        content={content}
        saving={sourceSaving}
        sourceCopied={sourceCopied}
        lintFindings={lintFindings}
        labels={{
          copy: labels.copy,
          copied: labels.copied,
          save: labels.save,
          saving: labels.saving,
        }}
        onContentChange={onContentChange}
        onCopy={onCopy}
        onSave={onSave}
      />
    );
  }

  if (isSketch && effectiveMode === 'preview') {
    return <SketchPreview content={content} />;
  }

  if (isMedia) {
    return (
      <MediaPreview
        projectId={projectId}
        path={path}
        kind={fileKind}
        zoom={zoom}
        fastStartNote={labels.fastStartNote}
      />
    );
  }

  return (
    <div className="text-muted-foreground flex h-full min-h-[420px] items-center justify-center rounded-md border text-sm">
      {labels.previewUnavailable}
    </div>
  );
}
