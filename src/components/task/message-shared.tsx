/**
 * Shared constants and components for message rendering.
 * Used by both TaskV2MessageBubble and UserMessageBubble.
 */

import { useRef, useState } from 'react';

import {
  MARKDOWN_EXTS,
  PDF_EXTS,
  TEXT_EXTS,
  extOf,
} from '@/components/shared/ChatInput.types';
import { API_BASE_URL } from '@/config';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';

import { MediaLightbox, type LightboxType } from './MediaLightbox';

/** Regex for stripping agent-only attachment context prefixes from display. */
export const ATTACHED_FILES_PREFIX_RE =
  /^(?:\[(?:ATTACHED FILES|CLOUD STORAGE ATTACHMENT CONTEXT)[\s\S]*?\]\n\n)+/;

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'tiff',
]);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']);

function classifyAttachment(att: MessageAttachment): LightboxType | null {
  const ext = extOf(att.name);
  if (att.type === 'image' || IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (TEXT_EXTS.has(ext)) return 'text';
  return null;
}

function buildSrc(att: MessageAttachment): string {
  if (att.path) {
    return `${API_BASE_URL}/files/stream?path=${encodeURIComponent(att.path)}`;
  }
  if (att.data) {
    return att.data.startsWith('data:')
      ? att.data
      : `data:${att.mimeType || 'image/png'};base64,${att.data}`;
  }
  return '';
}

export function ImageAttachmentPreview({
  attachment,
}: {
  attachment: MessageAttachment;
}) {
  const [open, setOpen] = useState(false);
  const src = buildSrc(attachment);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-zoom-in"
        aria-label={`Preview ${attachment.name}`}
      >
        <img
          src={src}
          alt={attachment.name}
          className="max-h-48 max-w-full rounded-lg object-contain"
        />
      </button>
      {open && (
        <MediaLightbox
          src={src}
          alt={attachment.name}
          type="image"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function FileAttachmentChip({
  attachment,
}: {
  attachment: MessageAttachment;
}) {
  const [open, setOpen] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const kind = classifyAttachment(attachment);
  const previewable = kind !== null && !!attachment.path;

  const handleClick = async () => {
    if (!previewable || !kind) return;
    setOpen(true);
    // Text-kind preview loads content lazily. PDF/image/audio/video use src.
    if (kind !== 'text' || textContent !== null || textError !== null) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const res = await fetch(`${API_BASE_URL}/files/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: attachment.path }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { content?: string; error?: string };
      if (body.error) throw new Error(body.error);
      setTextContent(body.content ?? '');
    } catch (err) {
      setTextError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      loadingRef.current = false;
    }
  };

  const src = previewable ? buildSrc(attachment) : '';
  const textLanguage: 'markdown' | 'code' = MARKDOWN_EXTS.has(
    extOf(attachment.name),
  )
    ? 'markdown'
    : 'code';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={!previewable}
        className={cn(
          'bg-primary-foreground/10 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs',
          previewable && 'hover:bg-primary-foreground/20 cursor-pointer',
        )}
        title={previewable ? `Preview ${attachment.name}` : attachment.name}
        aria-label={
          previewable ? `Preview ${attachment.name}` : attachment.name
        }
      >
        <span className="opacity-60">📎</span>
        <span className="max-w-[200px] truncate">{attachment.name}</span>
      </button>
      {open &&
        kind &&
        (kind !== 'text' || textContent !== null || textError !== null) && (
          <MediaLightbox
            src={src}
            alt={attachment.name}
            type={kind}
            textContent={
              kind === 'text' ? (textError ?? textContent ?? '') : undefined
            }
            textLanguage={kind === 'text' ? textLanguage : undefined}
            onClose={() => setOpen(false)}
          />
        )}
    </>
  );
}
