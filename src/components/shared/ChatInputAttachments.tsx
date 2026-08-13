/**
 * Attachment-related sub-components for ChatInput:
 * - Video thumbnail extraction (client-side + server-side fallback)
 * - VideoThumbnail component
 * - InlineWaveformBars (mic recording indicator)
 * - AttachmentPreview (attachment chips with remove button)
 */

import { useEffect, useMemo, useState } from 'react';

import { Film, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { getStreamUrl } from '@/components/artifacts/media-loader';
import {
  MediaLightbox,
  type LightboxType,
} from '@/components/task/MediaLightbox';
import { FileTypeIcon } from '@/components/ui/FileTypeIcon';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { API_BASE_URL } from '@/config';
import { DURATION, EASE, SPRING } from '@/config/animation';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  MARKDOWN_EXTS,
  PDF_EXTS,
  TEXT_EXTS,
  extOf,
  type Attachment,
} from './ChatInput.types';

// ============================================================================
// Video thumbnail extraction
// ============================================================================

/** Timeout for client-side frame extraction */
const THUMBNAIL_TIMEOUT_MS = 5_000;

/** Extract a video frame client-side via hidden <video> + canvas */
const extractFrameClientSide = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, THUMBNAIL_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.src = '';
      URL.revokeObjectURL(url);
    };

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(video.duration * 0.25, 5) || 0;
    };

    video.onseeked = () => {
      const { videoWidth: w, videoHeight: h } = video;
      if (!w || !h) {
        cleanup();
        reject(new Error('no dimensions'));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        cleanup();
        reject(new Error('no context'));
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      cleanup();
      resolve(dataUrl);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('load error'));
    };

    video.src = url;
  });

/** Server-side thumbnail extraction via FFmpeg (upload-based) */
const extractFrameServerSide = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('video', file);
  const res = await fetch(`${API_BASE_URL}/files/video-thumbnail`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!data.success || !data.thumbnail)
    throw new Error(data.error || 'extraction failed');
  return data.thumbnail;
};

/** Server-side thumbnail extraction via FFmpeg (path-based, no upload needed) */
const extractFrameByPath = async (filePath: string): Promise<string> => {
  const res = await fetch(`${API_BASE_URL}/files/video-thumbnail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
  const data = await res.json();
  if (!data.success || !data.thumbnail)
    throw new Error(data.error || 'extraction failed');
  return data.thumbnail;
};

// ============================================================================
// VideoThumbnail component
// ============================================================================

export function VideoThumbnail({
  file,
  localPath,
}: {
  file: File;
  localPath?: string;
}) {
  const { t } = useLanguage();
  const [thumbUrl, setThumbUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Try client-side first (instant for browser-supported codecs)
      try {
        const url = await extractFrameClientSide(file);
        if (!cancelled) {
          setThumbUrl(url);
          return;
        }
      } catch {
        // Fall through to server-side
      }

      // Fallback: server-side via FFmpeg (handles all codecs)
      // Use path-based extraction for Tauri drag-drop files (avoids uploading empty File)
      try {
        const url = localPath
          ? await extractFrameByPath(localPath)
          : await extractFrameServerSide(file);
        if (!cancelled) {
          setThumbUrl(url);
          return;
        }
      } catch {
        // Both methods failed
      }

      if (!cancelled) setFailed(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [file, localPath]);

  if (thumbUrl) {
    return (
      <img
        src={thumbUrl}
        className="h-10 w-10 rounded object-cover"
        alt={t.task.videoThumbnailAlt}
      />
    );
  }

  return (
    <div className="bg-muted flex h-10 w-10 items-center justify-center rounded">
      <Film
        className={cn(
          'text-muted-foreground h-5 w-5',
          !failed && 'animate-pulse',
        )}
      />
    </div>
  );
}

// ============================================================================
// Inline waveform bars for mic recording state
// ============================================================================

const INLINE_BAR_COUNT = 3;
const INLINE_BAR_BASE_HEIGHTS = [8, 14, 10];
const INLINE_BAR_DELAYS = [0, 0.08, 0.04];

export function InlineWaveformBars() {
  return (
    <div className="flex items-center gap-[2px]" aria-hidden="true">
      {Array.from({ length: INLINE_BAR_COUNT }, (_, i) => (
        <motion.div
          key={i}
          className="w-[2px] rounded-full bg-white"
          animate={{
            height: [
              INLINE_BAR_BASE_HEIGHTS[i] * 0.4,
              INLINE_BAR_BASE_HEIGHTS[i],
              INLINE_BAR_BASE_HEIGHTS[i] * 0.5,
              INLINE_BAR_BASE_HEIGHTS[i] * 0.9,
            ],
          }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            repeatType: 'mirror',
            ease: 'easeInOut',
            delay: INLINE_BAR_DELAYS[i],
          }}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Drag overlay
// ============================================================================

export function DragOverlay({
  isHome,
  label,
}: {
  isHome: boolean;
  label: string;
}) {
  return (
    <motion.div
      className={cn(
        'bg-primary/10 border-primary pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed',
        isHome ? 'rounded-2xl' : 'rounded-xl',
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.fast }}
    >
      <motion.div
        className="bg-background text-foreground rounded-lg px-6 py-3 text-sm font-medium shadow-lg"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ ...SPRING.snappy }}
      >
        📎 {label}
      </motion.div>
    </motion.div>
  );
}

// ============================================================================
// Attachment preview strip
// ============================================================================

/** 5 MB — larger files would freeze the webview on synchronous decode. */
const MAX_TEXT_PREVIEW_SIZE = 5 * 1024 * 1024;

interface LightboxResolution {
  src: string;
  type: LightboxType;
  textLanguage?: 'markdown' | 'code' | 'plain';
  revoke?: () => void;
}

/**
 * Produce a lightbox source URL for an attachment that has bytes or a
 * local path. Returns null when neither is available — the caller should
 * disable the preview affordance in that case.
 */
function urlSourceFor(
  attachment: Attachment,
  type: LightboxType,
): LightboxResolution | null {
  if (attachment.file.size > 0) {
    const url = URL.createObjectURL(attachment.file);
    return { src: url, type, revoke: () => URL.revokeObjectURL(url) };
  }
  if (attachment.localPath) {
    return { src: getStreamUrl(attachment.localPath), type };
  }
  return null;
}

function resolveLightboxSrc(attachment: Attachment): LightboxResolution | null {
  if (attachment.type === 'image' && attachment.preview) {
    return { src: attachment.preview, type: 'image' };
  }
  if (attachment.type === 'video') return urlSourceFor(attachment, 'video');
  if (attachment.type === 'audio') return urlSourceFor(attachment, 'audio');

  const ext = extOf(attachment.file.name);
  if (PDF_EXTS.has(ext)) return urlSourceFor(attachment, 'pdf');
  if (TEXT_EXTS.has(ext)) {
    // `src` is unused for text; content is loaded separately and passed
    // to the lightbox via textContent.
    return {
      src: '',
      type: 'text',
      textLanguage: MARKDOWN_EXTS.has(ext) ? 'markdown' : 'code',
    };
  }
  return null;
}

export function AttachmentPreview({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const previewAttachment = useMemo(
    () => attachments.find((a) => a.id === previewId) ?? null,
    [attachments, previewId],
  );
  // Depend on the stable id rather than the attachment reference — the
  // parent often recreates the attachments array, and re-running this memo
  // on every render would allocate a new blob: URL each time.
  const preview = useMemo(
    () => (previewAttachment ? resolveLightboxSrc(previewAttachment) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewAttachment?.id],
  );

  useEffect(() => () => preview?.revoke?.(), [preview]);

  // For text attachments, load the content lazily when the preview opens.
  // Prefer File.text() (in-memory blob) over backend /files/read to avoid
  // a round-trip when we already have the bytes in the browser.
  useEffect(() => {
    if (!previewAttachment || preview?.type !== 'text') {
      setTextPreview(null);
      setTextError(null);
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      setTextError(null);
      try {
        const a = previewAttachment;
        if (a.file.size > 0) {
          if (a.file.size > MAX_TEXT_PREVIEW_SIZE) {
            if (!ctrl.signal.aborted)
              setTextError(
                `File too large to preview (${Math.round(a.file.size / 1024 / 1024)} MB). Open it externally instead.`,
              );
            return;
          }
          const content = await a.file.text();
          if (!ctrl.signal.aborted) setTextPreview({ id: a.id, content });
          return;
        }
        if (a.localPath) {
          const res = await fetch(`${API_BASE_URL}/files/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: a.localPath }),
            signal: ctrl.signal,
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const body = (await res.json()) as {
            content?: string;
            error?: string;
          };
          if (body.error) throw new Error(body.error);
          if (!ctrl.signal.aborted)
            setTextPreview({ id: a.id, content: body.content ?? '' });
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if ((err as Error)?.name === 'AbortError') return;
        setTextError(
          err instanceof Error ? err.message : 'Failed to load preview',
        );
      }
    })();
    return () => ctrl.abort();
  }, [previewAttachment, preview]);

  const canPreview = (a: Attachment) => resolveLightboxSrc(a) !== null;

  return (
    <>
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            className="mb-3 flex flex-wrap gap-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: DURATION.normal, ease: EASE.out }}
          >
            {attachments.map((attachment, index) => {
              const previewable = canPreview(attachment);
              const openPreview = () => setPreviewId(attachment.id);
              const thumbClass = cn(
                'h-10 w-10 rounded',
                previewable && 'cursor-zoom-in',
              );
              return (
                <motion.div
                  key={attachment.id}
                  className="group border-border/50 bg-muted/50 relative flex items-center gap-2 rounded-lg border px-3 py-2"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{
                    duration: DURATION.normal,
                    delay: index * 0.05,
                  }}
                >
                  {attachment.type === 'image' && attachment.preview ? (
                    <button
                      type="button"
                      onClick={openPreview}
                      className={cn(thumbClass, 'block overflow-hidden')}
                      aria-label={`Preview ${attachment.file.name}`}
                    >
                      <img
                        src={attachment.preview}
                        alt={attachment.file.name}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : attachment.type === 'video' ? (
                    <button
                      type="button"
                      onClick={previewable ? openPreview : undefined}
                      className={cn(thumbClass, 'block overflow-hidden')}
                      aria-label={`Preview ${attachment.file.name}`}
                      disabled={!previewable}
                    >
                      <VideoThumbnail
                        file={attachment.file}
                        localPath={attachment.localPath}
                      />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={previewable ? openPreview : undefined}
                      className={cn(
                        thumbClass,
                        'bg-muted flex items-center justify-center',
                      )}
                      aria-label={
                        previewable
                          ? `Preview ${attachment.file.name}`
                          : attachment.file.name
                      }
                      disabled={!previewable}
                    >
                      <FileTypeIcon
                        filename={attachment.file.name}
                        mimeType={attachment.file.type}
                        className="text-muted-foreground h-5 w-5"
                      />
                    </button>
                  )}
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-foreground max-w-[120px] truncate text-sm">
                          {attachment.file.name}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs break-all">
                        {attachment.localPath || attachment.file.name}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(attachment.id);
                    }}
                    className="bg-foreground text-background absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Remove ${attachment.file.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
      {previewAttachment &&
        preview &&
        // Gate the text-type open until content is loaded (or an error is
        // ready to display) so we don't flash an empty `<pre>`.
        (preview.type !== 'text' ||
          textPreview?.id === previewAttachment.id ||
          textError !== null) && (
          <MediaLightbox
            src={preview.src}
            alt={previewAttachment.file.name}
            type={preview.type}
            textContent={
              preview.type === 'text'
                ? (textError ?? textPreview?.content ?? '')
                : undefined
            }
            textLanguage={preview.textLanguage}
            onClose={() => setPreviewId(null)}
          />
        )}
    </>
  );
}
