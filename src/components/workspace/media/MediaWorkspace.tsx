import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AudioLines,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  Play,
  Send,
  Video,
  X,
} from 'lucide-react';

import { AudioPreview } from '@/components/artifacts/AudioPreview';
import { FileTooLarge } from '@/components/artifacts/FileTooLarge';
import {
  formatFileSize,
  getImageMimeType,
  isRemoteUrl,
  MAX_PREVIEW_SIZE,
  openFileExternal,
} from '@/components/artifacts/utils';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { saveSettings, useSettingsValue } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { WorkspaceProps } from '../types';
import { ComparisonSlider } from './ComparisonSlider';
import { VersionStrip } from './VersionStrip';

export function MediaWorkspace({
  artifact,
  // allArtifacts intentionally unused — reserved for future multi-artifact comparison
  versions,
  context,
  onClose,
  onSelectVersion,
  onSendMessage,
}: WorkspaceProps) {
  const { t } = useLanguage();
  const settings = useSettingsValue();
  const autoPlay = settings.autoPlayMedia ?? false;
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileTooLarge, setFileTooLarge] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [replyText, setReplyText] = useState('');
  // Resolved path (may differ from artifact.path after find-file fallback)
  const [resolvedPath, setResolvedPath] = useState<string | null>(
    artifact.path ?? null,
  );
  const blobUrlRef = useRef<string | null>(null);

  // Load media
  useEffect(() => {
    let cancelled = false;

    async function loadMedia() {
      // Cleanup previous blob URL
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      setLoading(true);
      setError(null);
      setFileTooLarge(null);
      setImageDimensions(null);

      // Data URL or remote URL in content
      if (
        artifact.content &&
        (artifact.content.startsWith('data:') ||
          artifact.content.startsWith('http'))
      ) {
        setMediaUrl(artifact.content);
        setLoading(false);
        return;
      }

      if (!artifact.path) {
        setError('No file path available');
        setLoading(false);
        return;
      }

      try {
        // Resolve the real path (handles wrong/relative paths)
        let effectivePath = artifact.path;
        if (!isRemoteUrl(artifact.path)) {
          const { resolveMediaPath, getFileSize } =
            await import('@/components/artifacts/media-loader');
          effectivePath = await resolveMediaPath(artifact.path);
          if (!cancelled) setResolvedPath(effectivePath);

          // Size check only for non-streamable types (images)
          if (artifact.type !== 'video' && artifact.type !== 'audio') {
            const size = await getFileSize(effectivePath);
            if (size !== null && size > MAX_PREVIEW_SIZE) {
              if (!cancelled) {
                setFileTooLarge(size);
                setLoading(false);
              }
              return;
            }
          }
        }

        if (isRemoteUrl(effectivePath)) {
          const url = effectivePath.startsWith('//')
            ? `https:${effectivePath}`
            : effectivePath;
          if (!cancelled) {
            setMediaUrl(url);
          }
        } else if (artifact.type === 'video' || artifact.type === 'audio') {
          // Stream video/audio directly — no memory bloat, supports seeking
          const { getStreamUrl } =
            await import('@/components/artifacts/media-loader');
          if (!cancelled) {
            setMediaUrl(getStreamUrl(effectivePath));
          }
        } else {
          // Images: load as blob (typically small)
          const ext = effectivePath.split('.').pop()?.toLowerCase() || '';
          const mimeType = getImageMimeType(ext);

          const { readBinaryFile } =
            await import('@/components/artifacts/media-loader');
          const blob = await readBinaryFile(effectivePath, mimeType);
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;

          if (!cancelled) {
            setMediaUrl(url);
          }
        }

        if (!cancelled) {
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMedia();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [artifact.path, artifact.content, artifact.type]);

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setImageDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    },
    [],
  );

  const handleOpenExternal = useCallback(() => {
    const p = resolvedPath || artifact.path;
    if (p) {
      openFileExternal(p);
    }
  }, [resolvedPath, artifact.path]);

  const handleCopyPath = useCallback(async () => {
    const p = resolvedPath || artifact.path;
    if (p) {
      try {
        await navigator.clipboard.writeText(p);
      } catch (err) {
        console.error('[MediaWorkspace] Failed to copy path:', err);
      }
    }
  }, [resolvedPath, artifact.path]);

  const handleDownload = useCallback(async () => {
    const p = resolvedPath || artifact.path;
    if (!p) return;

    const filename = artifact.name || p.split('/').pop() || 'download';

    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const savePath = await save({ defaultPath: filename });
      if (!savePath) return;

      try {
        const { copyFile } = await import('@tauri-apps/plugin-fs');
        await copyFile(p, savePath);
      } catch {
        // copyFile may fail due to scope restrictions — fall back to read + write
        const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');
        const data = await readFile(p);
        await writeFile(savePath, data);
      }
    } catch {
      // Tauri not available — browser fallback
      if (mediaUrl) {
        const a = document.createElement('a');
        a.href = mediaUrl;
        a.download = filename;
        a.click();
      }
    }
  }, [resolvedPath, artifact.path, artifact.name, mediaUrl]);

  const handleToggleAutoPlay = useCallback(() => {
    saveSettings({ ...settings, autoPlayMedia: !autoPlay });
  }, [settings, autoPlay]);

  const handleSendReply = useCallback(() => {
    if (replyText.trim() && onSendMessage) {
      onSendMessage(replyText.trim());
      setReplyText('');
    }
  }, [replyText, onSendMessage]);

  const handleReplyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendReply();
      }
    },
    [handleSendReply],
  );

  // Escape key to exit comparison mode and fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (compareMode) {
          setCompareMode(false);
        } else if (isFullscreen) {
          setIsFullscreen(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [compareMode, isFullscreen]);

  // Get comparison images
  const compareVersions = versions.length >= 2;
  const beforeVersion =
    versions.length >= 2 ? versions[versions.length - 2] : null;

  // Get the file extension
  const fileExt = (
    artifact.path?.split('.').pop() ||
    artifact.name.split('.').pop() ||
    ''
  ).toUpperCase();

  if (fileTooLarge !== null) {
    return (
      <div
        className={cn(
          'bg-background flex h-full flex-col',
          isFullscreen && 'fixed inset-0 z-50',
        )}
      >
        <FileTooLarge
          artifact={artifact}
          fileSize={fileTooLarge}
          icon={artifact.type === 'video' ? Video : AudioLines}
          onOpenExternal={handleOpenExternal}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-background flex h-full flex-col',
        isFullscreen && 'fixed inset-0 z-50',
      )}
    >
      {/* Header */}
      <div className="border-border/50 bg-muted/30 flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium">
            {artifact.name}
          </span>
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
            {fileExt}
          </span>
          {imageDimensions && (
            <span className="text-muted-foreground/70 shrink-0 text-[10px]">
              {imageDimensions.width} x {imageDimensions.height}
            </span>
          )}
          {artifact.fileSize && (
            <span className="text-muted-foreground/70 shrink-0 text-[10px]">
              {formatFileSize(artifact.fileSize)}
            </span>
          )}
        </div>

        <TooltipProvider delayDuration={300}>
          <div className="flex shrink-0 items-center gap-1">
            {(artifact.type === 'audio' || artifact.type === 'video') && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleToggleAutoPlay}
                    aria-label={
                      autoPlay ? t.settings.autoPlayOn : t.settings.autoPlayOff
                    }
                    className={cn(
                      'text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors',
                      autoPlay && 'bg-accent text-foreground',
                    )}
                  >
                    <Play className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    {autoPlay ? t.settings.autoPlayOn : t.settings.autoPlayOff}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}

            {compareVersions && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setCompareMode(!compareMode)}
                    aria-label="Compare versions"
                    className={cn(
                      'text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors',
                      compareMode && 'bg-accent text-foreground',
                    )}
                  >
                    <Columns2 className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Compare</p>
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleDownload}
                  aria-label="Download"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                >
                  <Download className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Download</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleOpenExternal}
                  aria-label="Open in external app"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                >
                  <ExternalLink className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Open External</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCopyPath}
                  aria-label="Copy file path"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                >
                  <Copy className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Copy Path</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                >
                  {isFullscreen ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <Maximize2 className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onClose}
                  aria-label="Close workspace"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                >
                  <X className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Close</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* Hero View */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <AILoadingIndicator size="md" label="Loading media" />
              <p className="text-muted-foreground text-sm">Loading media…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-muted-foreground text-sm">{error}</p>
              <button
                onClick={handleOpenExternal}
                className="text-primary text-sm hover:underline"
              >
                Open in external app
              </button>
            </div>
          ) : compareMode && beforeVersion && mediaUrl ? (
            <ComparisonSlider
              beforeSrc={beforeVersion.path}
              afterSrc={mediaUrl}
            />
          ) : artifact.type === 'audio' ? (
            <AudioPreview artifact={artifact} autoPlay={autoPlay} />
          ) : artifact.type === 'video' && mediaUrl ? (
            <div className="w-full max-w-4xl">
              <video
                src={mediaUrl}
                controls
                autoPlay={autoPlay}
                className="max-h-[70vh] w-full rounded-lg bg-black shadow-xl"
                preload="metadata"
              />
            </div>
          ) : mediaUrl ? (
            <img
              src={mediaUrl}
              alt={artifact.name}
              className="max-h-[70vh] max-w-full rounded-lg object-contain shadow-sm"
              onLoad={handleImageLoad}
            />
          ) : null}
        </div>

        {/* Version Strip */}
        {versions.length > 0 && (
          <VersionStrip
            versions={versions}
            activeVersionId={
              versions.find((v) => v.artifactId === artifact.id)?.id ||
              versions[versions.length - 1]?.id ||
              ''
            }
            onSelectVersion={onSelectVersion}
          />
        )}
      </div>

      {/* Inline Reply */}
      {onSendMessage && (
        <div className="border-border/50 shrink-0 border-t px-4 py-2">
          <div className="bg-muted/50 border-border/50 flex items-center gap-2 rounded-lg border px-3 py-1.5">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleReplyKeyDown}
              placeholder={
                context.isRunning
                  ? 'Agent is working...'
                  : 'Describe your next edit...'
              }
              disabled={context.isRunning}
              className="text-foreground placeholder:text-muted-foreground/50 min-w-0 flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSendReply}
              disabled={!replyText.trim() || context.isRunning}
              className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-30"
            >
              <Send className="size-4" />
            </button>
          </div>
          <p className="text-muted-foreground/50 mt-1 text-[10px]">
            Quick edit
          </p>
        </div>
      )}
    </div>
  );
}

export default MediaWorkspace;
