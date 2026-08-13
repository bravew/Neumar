import { useEffect, useMemo, useRef, useState } from 'react';

import { toast } from 'sonner';

import type {
  InspectStylePatch,
  NeumaTargetPayload,
} from '@/components/artifacts/live/iframe-sandbox';
import {
  createPaletteBridgeScript,
  type PaletteBridgeRequest,
} from '@/components/artifacts/live/palette-bridge';
import {
  exportAsImage,
  requestPreviewSnapshot,
} from '@/components/artifacts/live/preview-snapshot';
import { DEFAULT_DESIGN_MODE_SETTINGS, useSetting } from '@/shared/db/settings';
import { readDesignFile } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignFileEntry,
  DesignCommentAttachment,
  DesignSurface,
  DrawStroke,
} from '@/shared/types/design-mode';

import { CommentRail } from './CommentRail';
import type { DeviceViewportId } from './DevicePicker';
import { FileViewerEditSidebar } from './edit/FileViewerEditSidebar';
import { ExportsDrawer } from './ExportsDrawer';
import { fileViewerPreviewLabels } from './file-viewer-labels';
import { persistDesignModeUi } from './file-viewer-settings';
import {
  candidateHtmlEntriesForModule,
  classifyFile,
  findJsModuleHtmlEntry,
  flattenDesignFilePaths,
  isJsModuleFilePath,
  sketchScreenIdFromPath,
} from './file-viewer-utils';
import { FileViewerPreviewPane } from './FileViewerPreviewPane';
import { FileViewerToolbar } from './FileViewerToolbar';
import { GenerationNextSteps } from './GenerationNextSteps';
import { InspectPanel } from './InspectPanel';
import type { PreviewMode } from './PreviewModeSegments';
import { useFileViewerComments } from './use-file-viewer-comments';
import { useFileViewerContent } from './use-file-viewer-content';
import { useManualEditSession } from './use-manual-edit-session';

export function FileViewer({
  projectId,
  surface,
  path,
  reloadKey = 0,
  projectFiles = [],
  onDirtySketchChange,
  onSendToChat,
}: {
  projectId: string;
  surface: DesignSurface;
  path: string | null;
  reloadKey?: number;
  projectFiles?: DesignFileEntry[];
  onDirtySketchChange?: (dirty: boolean) => void;
  onSendToChat?: (prompt: string) => void;
}) {
  const { t } = useLanguage();
  const designModeSettings = useSetting('designMode');
  const [mode, setMode] = useState<PreviewMode>('preview');
  const [zoom, setZoom] = useState(100);
  const [target, setTarget] = useState<NeumaTargetPayload | null>(null);
  const [targetText, setTargetText] = useState('');
  const [inspectPatch, setInspectPatch] = useState<InspectStylePatch | null>(
    null,
  );
  const [exportsOpen, setExportsOpen] = useState(false);
  const [deviceViewport, setDeviceViewport] =
    useState<DeviceViewportId>('auto');
  const [dirtySketch, setDirtySketch] = useState(false);
  const [palettePreset, setPalettePreset] = useState('original');
  const [paletteRequest, setPaletteRequest] =
    useState<PaletteBridgeRequest | null>(null);
  const [modulePreview, setModulePreview] = useState<{
    entryPath: string;
    html: string;
  } | null>(null);
  const [availableTargets, setAvailableTargets] = useState<
    NeumaTargetPayload[]
  >([]);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoModulePreviewPathRef = useRef<string | null>(null);
  const designUi = {
    ...DEFAULT_DESIGN_MODE_SETTINGS.ui,
    ...(designModeSettings?.ui ?? {}),
  };
  const commentRailCollapsed =
    designUi.commentRailCollapsed[projectId] ?? false;
  const fileKind = classifyFile(path);
  const isHtml = fileKind === 'html';
  const isSketch = fileKind === 'sketch';
  const isText = fileKind === 'html' || fileKind === 'text' || isSketch;
  const isMedia =
    fileKind === 'image' || fileKind === 'video' || fileKind === 'audio';
  const projectFilePaths = useMemo(
    () => flattenDesignFilePaths(projectFiles),
    [projectFiles],
  );
  const projectFilePathKey = projectFilePaths.join('\0');

  useEffect(() => {
    if (!path || !isJsModuleFilePath(path)) {
      setModulePreview(null);
      return;
    }
    const candidates = candidateHtmlEntriesForModule(path, projectFilePaths);
    if (candidates.length === 0) {
      setModulePreview(null);
      return;
    }
    const ac = new AbortController();
    void Promise.all(
      candidates.map(async (candidatePath) => {
        const file = await readDesignFile(projectId, candidatePath, {
          signal: ac.signal,
        });
        return { path: candidatePath, content: file.content };
      }),
    )
      .then((htmlCandidates) => {
        if (ac.signal.aborted) return;
        const entryPath = findJsModuleHtmlEntry(path, htmlCandidates);
        const entry = htmlCandidates.find((item) => item.path === entryPath);
        setModulePreview(
          entry ? { entryPath: entry.path, html: entry.content } : null,
        );
      })
      .catch(() => {
        if (!ac.signal.aborted) setModulePreview(null);
      });
    return () => ac.abort();
  }, [path, projectFilePathKey, projectFilePaths, projectId, reloadKey]);

  const hasModulePreview = Boolean(modulePreview);
  const htmlPreviewPath = isHtml ? path : modulePreview?.entryPath;
  const htmlPreviewContent = isHtml ? undefined : modulePreview?.html;
  const canRenderHtmlPreview = isHtml || hasModulePreview;

  useEffect(() => {
    autoModulePreviewPathRef.current = null;
  }, [path]);

  useEffect(() => {
    if (
      !path ||
      !hasModulePreview ||
      mode !== 'source' ||
      autoModulePreviewPathRef.current === path
    ) {
      return;
    }
    autoModulePreviewPathRef.current = path;
    setMode('preview');
  }, [hasModulePreview, mode, path]);

  const availableModes = useMemo<PreviewMode[]>(() => {
    if (isHtml) {
      return ['preview', 'source', 'inspect', 'comment', 'edit', 'draw'];
    }
    if (hasModulePreview) return ['preview', 'source', 'draw'];
    if (isSketch) return ['preview', 'source', 'draw'];
    if (isText) return ['source', 'draw'];
    if (isMedia) return ['preview', 'draw'];
    return ['preview'];
  }, [hasModulePreview, isHtml, isMedia, isSketch, isText]);
  const defaultMode =
    isHtml || isSketch || hasModulePreview
      ? 'preview'
      : isText
        ? 'source'
        : 'preview';
  const effectiveMode = availableModes.includes(mode) ? mode : defaultMode;
  const contentState = useFileViewerContent({
    projectId,
    path,
    isText,
    reloadKey,
  });
  const resetContentViewState = contentState.resetViewState;
  const paletteAllowed =
    canRenderHtmlPreview &&
    (htmlPreviewContent ?? contentState.content).length <= 2_000_000;
  const paletteBridge = useMemo(
    () => (paletteAllowed ? createPaletteBridgeScript() : undefined),
    [paletteAllowed],
  );
  const comments = useFileViewerComments({ projectId, path, effectiveMode });
  const manualEdit = useManualEditSession({
    projectId,
    path,
    effectiveMode,
    target,
    setContent: contentState.setContent,
    setInspectPatch,
  });

  useEffect(() => {
    setTarget(null);
    setTargetText('');
    setInspectPatch(null);
    setAvailableTargets([]);
    resetContentViewState();
    setDirtySketch(false);
    onDirtySketchChange?.(false);
  }, [resetContentViewState, onDirtySketchChange, path, mode]);

  useEffect(() => {
    if (!availableModes.includes(mode)) setMode(defaultMode);
  }, [availableModes, defaultMode, mode]);

  useEffect(() => {
    const persisted = designUi.viewMode[projectId] as PreviewMode | undefined;
    if (persisted && availableModes.includes(persisted)) {
      setMode(persisted);
    }
  }, [availableModes, designUi.viewMode, projectId]);

  const changeMode = (nextMode: PreviewMode) => {
    if (
      effectiveMode === 'draw' &&
      nextMode !== 'draw' &&
      dirtySketch &&
      !globalThis.confirm?.(t.design.closeDirtySketchConfirm)
    ) {
      return;
    }
    setMode(nextMode);
    persistDesignModeUi({
      viewMode: { [projectId]: nextMode },
    });
  };

  const updateCommentRailCollapsed = (collapsed: boolean) => {
    persistDesignModeUi({
      commentRailCollapsed: { [projectId]: collapsed },
    });
  };

  const updateDirtySketch = (dirty: boolean) => {
    setDirtySketch(dirty);
    onDirtySketchChange?.(dirty);
  };

  const applyInspectPatch = (patch: InspectStylePatch) => {
    setInspectPatch(patch);
    setTarget((prev) => {
      if (!prev || prev.id !== patch.id) return prev;
      return {
        ...prev,
        styles: {
          ...prev.styles,
          [patch.prop]: patch.value,
        },
      };
    });
  };

  const applyPalette = (id: string, request: PaletteBridgeRequest) => {
    setPalettePreset(id);
    setPaletteRequest({ ...request });
  };

  const submitDrawComment = async (
    strokes: DrawStroke[],
    viewport: { width: number; height: number; scale: number },
  ) => {
    await comments.submitDrawComment({
      strokes,
      viewport,
      label: t.design.drawAnnotation,
      text: t.design.drawAnnotationComment,
    });
    onSendToChat?.(t.design.drawAnnotationComment);
  };

  const exportPreviewImage = async () => {
    if (!path) return;
    try {
      const snapshot = await requestPreviewSnapshot(previewFrameRef.current);
      await exportAsImage(path.split('/').pop() ?? 'preview', snapshot, {
        drawCanvas: drawCanvasRef.current,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (!path) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {t.design.noFiles}
      </div>
    );
  }

  const submitCommentWithAttachments = async (
    attachToChat: boolean,
    attachments: DesignCommentAttachment[],
  ) => {
    if (!target || !targetText.trim()) return;
    await comments.submitTargetComment({
      target,
      text: targetText,
      attachToChat,
      attachments,
    });
    setTargetText('');
  };

  const sketchScreenId = sketchScreenIdFromPath(path);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileViewerToolbar
        path={path}
        effectiveMode={effectiveMode}
        availableModes={availableModes}
        isHtml={isHtml}
        isMedia={isMedia}
        isText={isText}
        zoom={zoom}
        deviceViewport={deviceViewport}
        paletteAllowed={paletteAllowed}
        palettePreset={palettePreset}
        linting={contentState.linting}
        lintFindings={contentState.lintFindings}
        canExportImage={canRenderHtmlPreview && effectiveMode !== 'source'}
        labels={t.design}
        onModeChange={changeMode}
        onDeviceViewportChange={setDeviceViewport}
        onPaletteChange={applyPalette}
        onZoomChange={setZoom}
        onLint={contentState.runLint}
        onOpenExports={() => setExportsOpen(true)}
        onExportImage={() => void exportPreviewImage()}
      />
      <GenerationNextSteps
        path={path}
        onExport={() => setExportsOpen(true)}
        onSendToChat={onSendToChat}
      />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto p-3">
          {contentState.readError && isText ? (
            <div className="border-destructive/30 flex min-h-[320px] flex-col items-center justify-center rounded-md border p-6 text-center">
              <p className="text-destructive text-sm">
                {t.design.files.readFailed}
              </p>
              <button
                type="button"
                className="text-primary mt-3 text-sm font-medium hover:underline"
                onClick={contentState.retryRead}
              >
                {t.design.files.retry}
              </button>
            </div>
          ) : (
            <FileViewerPreviewPane
              projectId={projectId}
              path={path}
              fileKind={fileKind}
              isText={isText}
              isHtml={isHtml}
              isMedia={isMedia}
              isSketch={isSketch}
              htmlPreviewPath={htmlPreviewPath ?? null}
              htmlPreviewContent={htmlPreviewContent}
              modulePreviewEntryPath={modulePreview?.entryPath}
              effectiveMode={effectiveMode}
              sketchScreenId={sketchScreenId}
              content={contentState.content}
              sourceSaving={contentState.saving}
              sourceCopied={contentState.sourceCopied}
              lintFindings={contentState.lintFindings}
              zoom={zoom}
              deviceViewport={deviceViewport}
              inspectPatch={inspectPatch}
              paletteBridge={paletteBridge}
              paletteRequest={paletteRequest}
              target={target}
              targetText={targetText}
              commentSaving={comments.saving}
              labels={fileViewerPreviewLabels(t)}
              onContentChange={contentState.setContent}
              onCopy={contentState.copySource}
              onSave={contentState.save}
              onDirtySketchChange={updateDirtySketch}
              onTarget={setTarget}
              onTargets={setAvailableTargets}
              onFrameRef={(node) => {
                previewFrameRef.current = node;
              }}
              onDrawCanvasRef={(canvas) => {
                drawCanvasRef.current = canvas;
              }}
              onTargetTextChange={setTargetText}
              onTargetClose={() => setTarget(null)}
              onCommentSubmit={submitCommentWithAttachments}
              onDrawSubmit={submitDrawComment}
            />
          )}
        </div>
        {effectiveMode === 'comment' && (
          <CommentRail
            projectId={projectId}
            comments={comments.comments}
            activeFile={path}
            collapsed={commentRailCollapsed}
            onResolve={comments.resolveComment}
            onDelete={comments.deleteComment}
            onCollapsedChange={updateCommentRailCollapsed}
          />
        )}
        {effectiveMode === 'edit' && (
          <FileViewerEditSidebar
            target={target}
            availableTargets={availableTargets}
            manualEdit={manualEdit}
            onTargetSelect={setTarget}
          />
        )}
        {effectiveMode === 'inspect' && (
          <InspectPanel target={target} onPatch={applyInspectPatch} />
        )}
      </div>
      <ExportsDrawer
        open={exportsOpen}
        onOpenChange={setExportsOpen}
        projectId={projectId}
        surface={surface}
      />
    </div>
  );
}
