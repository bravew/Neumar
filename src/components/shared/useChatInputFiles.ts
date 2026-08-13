/**
 * Custom hook encapsulating file attachment logic for ChatInput:
 * - Adding files from browser file picker / clipboard paste
 * - Adding files by local path (Tauri desktop)
 * - Drag-and-drop handling (HTML5 + Tauri native)
 * - Folder drop permission flow
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { getSettings, saveSettings } from '@/shared/db/settings';
import {
  addOrUpdateFolder,
  extractFolderName,
  isDirectory,
  isFolderAlwaysAllowed,
} from '@/shared/lib/folder-permissions';
import { grantFileReadAccess } from '@/shared/lib/tauri-scope';
import type { PermissionDialogResult } from '@/shared/types/folder-permissions';

import type { Attachment, AttachmentSourceContext } from './ChatInput.types';
import {
  AUDIO_EXTS,
  createImagePreview,
  FILE_MIME_MAP,
  generateId,
  IMAGE_EXTS,
  inTauri,
  isAudioFile,
  isImageFile,
  isVideoFile,
  VIDEO_EXTS,
} from './ChatInput.types';

/**
 * Extract absolute file paths from HTML5 DataTransfer text data.
 * VS Code/Cursor drags provide file:// URIs via text/uri-list and
 * absolute paths via text/plain, even though native file objects are absent.
 */
function extractFilePathsFromTextData(
  uriList: string,
  plainText: string,
): string[] {
  const paths: string[] = [];

  if (uriList) {
    for (const line of uriList.split(/[\r\n]+/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('file://')) {
        try {
          const decoded = decodeURIComponent(new URL(trimmed).pathname);
          if (decoded) paths.push(decoded);
        } catch {
          /* skip malformed URIs */
        }
      }
    }
  }

  if (paths.length === 0 && plainText) {
    for (const line of plainText.split(/[\r\n]+/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('/') && !trimmed.includes('\t')) {
        paths.push(trimmed);
      }
    }
  }

  return paths;
}

export interface UseChatInputFilesOptions {
  disabled: boolean;
  effectiveWorkDirsRef: React.RefObject<string[]>;
  handleWorkDirsChange: (folders: string[]) => void;
  acceptsFile?: (file: File) => boolean;
}

export function useChatInputFiles({
  disabled,
  effectiveWorkDirsRef,
  handleWorkDirsChange,
  acceptsFile,
}: UseChatInputFilesOptions) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingDropFolders, setPendingDropFolders] = useState<string[]>([]);
  const [dropFolderDialogOpen, setDropFolderDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  // Add files by local path (Tauri desktop only)
  const addFilePaths = useCallback(
    async (paths: string[]) => {
      // Widen Tauri's runtime fs scope so drops from outside the static
      // allowlist (e.g. external drives) become readable. No-op in browser.
      await grantFileReadAccess(paths);
      const newAttachments: Attachment[] = [];
      for (const p of paths) {
        const name = p.split('/').pop() || p;
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const isImage = IMAGE_EXTS.includes(ext);
        const type = isImage
          ? ('image' as const)
          : VIDEO_EXTS.includes(ext)
            ? ('video' as const)
            : AUDIO_EXTS.includes(ext)
              ? ('audio' as const)
              : ('file' as const);
        const attachment: Attachment = {
          id: generateId(),
          file: new File([], name, {
            type: FILE_MIME_MAP[ext] || 'application/octet-stream',
          }),
          type,
          localPath: p,
        };
        if (acceptsFile && !acceptsFile(attachment.file)) continue;
        if (isImage) {
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const bytes = await readFile(p);
            const mime = FILE_MIME_MAP[ext] || 'image/png';
            const base64 = btoa(
              Array.from(bytes, (b) => String.fromCharCode(b)).join(''),
            );
            attachment.preview = `data:${mime};base64,${base64}`;
          } catch (err) {
            if (import.meta.env.DEV)
              console.error('[ChatInput] Failed to read image from path:', err);
          }
        }
        newAttachments.push(attachment);
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
    },
    [acceptsFile],
  );

  // Add files (browser mode / clipboard paste / file picker)
  const addFiles = useCallback(
    async (
      files: FileList | File[],
      forceImage = false,
      sourceContexts?: AttachmentSourceContext[],
    ) => {
      const fileArray = Array.from(files);
      const acceptedFiles = acceptsFile
        ? fileArray.filter((file) => acceptsFile(file))
        : fileArray;
      if (import.meta.env.DEV) {
        console.warn('[ChatInput] addFiles called:', {
          count: acceptedFiles.length,
          files: acceptedFiles.map(
            (f) =>
              `${f.name}(${(f.size / 1024 / 1024).toFixed(1)}MB, ${f.type})`,
          ),
          forceImage,
        });
      }
      const newAttachments: Attachment[] = [];
      for (const [index, file] of acceptedFiles.entries()) {
        const isImage = forceImage || isImageFile(file);
        const isVideo = !isImage && isVideoFile(file);
        const isAudio = !isImage && !isVideo && isAudioFile(file);
        const attachment: Attachment = {
          id: generateId(),
          file,
          type: isImage
            ? 'image'
            : isVideo
              ? 'video'
              : isAudio
                ? 'audio'
                : 'file',
          sourceContext: sourceContexts?.[index],
        };
        if (isImage) {
          try {
            attachment.preview = await createImagePreview(file);
          } catch (error) {
            if (import.meta.env.DEV)
              console.error('[ChatInput] Failed to read image data:', error);
          }
        }
        newAttachments.push(attachment);
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
    },
    [acceptsFile],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = '';
      }
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        await addFiles(imageFiles, true);
      }
    },
    [addFiles],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // ── Folder drag-drop permission ──
  const grantDroppedFolder = useCallback(
    (path: string, alwaysAllow: boolean) => {
      const now = new Date().toISOString();
      const folder = {
        path,
        displayName: extractFolderName(path),
        permissions: { read: true, write: true, delete: false },
        alwaysAllow,
        lastUsed: now,
      };
      const current = getSettings();
      saveSettings({
        ...current,
        allowedFolders: addOrUpdateFolder(current.allowedFolders, folder),
      });
      handleWorkDirsChange([...effectiveWorkDirsRef.current, path]);
      // Mirror the app-level grant into Tauri's runtime fs scope.
      void grantFileReadAccess([path]);
    },
    [handleWorkDirsChange, effectiveWorkDirsRef],
  );

  const handleDroppedFolders = useCallback(
    (dirPaths: string[]) => {
      const settings = getSettings();
      const needPermission: string[] = [];
      for (const p of dirPaths) {
        if (isFolderAlwaysAllowed(settings.allowedFolders, p))
          grantDroppedFolder(p, true);
        else needPermission.push(p);
      }
      if (needPermission.length > 0) {
        setPendingDropFolders(needPermission);
        setDropFolderDialogOpen(true);
      }
    },
    [grantDroppedFolder],
  );

  const handleDropFolderDialogResult = useCallback(
    (result: PermissionDialogResult) => {
      setDropFolderDialogOpen(false);
      const [current, ...remaining] = pendingDropFolders;
      if (result.action === 'allow' && current)
        grantDroppedFolder(current, result.alwaysAllow);
      if (remaining.length > 0) {
        setPendingDropFolders(remaining);
        setTimeout(() => setDropFolderDialogOpen(true), 100);
      } else {
        setPendingDropFolders([]);
      }
    },
    [pendingDropFolders, grantDroppedFolder],
  );

  // ── Tauri native file drop (safety net when dragDropEnabled is true) ─────
  // With `dragDropEnabled: false` in tauri.conf.json — the project default,
  // shared with the DesignMode ImportDialog and Video Mode TimelineTrack
  // drop zones — file drops arrive as HTML5 events on the page and are
  // handled by the handlers below. This Tauri listener is kept as a safety
  // net so that if `dragDropEnabled` is ever flipped to true, drops onto
  // the chat input still flow through `addFilePaths` and benefit from the
  // grantFileReadAccess + sandbox-widening pipeline.
  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const unlistenFn = await getCurrentWebview().onDragDropEvent(
          (event) => {
            if (event.payload.type === 'over') {
              if (!disabled) setIsDragOver(true);
            } else if (event.payload.type === 'drop') {
              // Logged in production for parity with the HTML5 fallback —
              // makes triage of "agent didn't see my drop" reports possible
              // without forcing a dev rebuild.
              console.warn(
                '[ChatInput] Tauri onDragDropEvent DROP:',
                event.payload.paths,
              );
              setIsDragOver(false);
              dragDepthRef.current = 0;
              const dropPaths = (event.payload as { paths: string[] }).paths;
              if (!disabled && dropPaths.length > 0) {
                (async () => {
                  const checks = await Promise.all(
                    dropPaths.map(async (p: string) => ({
                      path: p,
                      isDir: await isDirectory(p),
                    })),
                  );
                  const filePaths = checks
                    .filter((c) => !c.isDir)
                    .map((c) => c.path);
                  const dirPaths = checks
                    .filter((c) => c.isDir)
                    .map((c) => c.path);
                  if (filePaths.length > 0) addFilePaths(filePaths);
                  if (dirPaths.length > 0) handleDroppedFolders(dirPaths);
                })();
              }
            } else {
              setIsDragOver(false);
              dragDepthRef.current = 0;
            }
          },
        );
        if (cancelled) unlistenFn();
        else unlisten = unlistenFn;
      } catch (err) {
        if (import.meta.env.DEV)
          console.error('[ChatInput] Failed to register Tauri drag-drop:', err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [disabled, addFilePaths, handleDroppedFolders]);

  // ── HTML5 drag-drop handlers ──
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    },
    [disabled],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragDepthRef.current += 1;
      const types = e.dataTransfer.types;
      const hasDroppable =
        types.includes('Files') ||
        types.includes('text/uri-list') ||
        types.includes('text/plain');
      if (hasDroppable) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragOver(false);
      if (disabled) return;

      if (inTauri) {
        // With dragDropEnabled:false, ALL drops arrive here as HTML5 events.
        // Extract file paths from text/uri-list (file:// URIs) or text/plain.
        const uriList = e.dataTransfer.getData('text/uri-list');
        const textData = e.dataTransfer.getData('text/plain');
        const paths = extractFilePathsFromTextData(uriList, textData);
        // Logged in production too — when Finder drops fall through to the
        // File-object fallback, the file gets uploaded as multipart and is
        // subject to the backend's in-memory size cap. Surfacing this drop
        // diagnostic is the fastest way to triage "agent didn't see my file"
        // reports without forcing a dev rebuild.
        console.warn('[ChatInput] HTML5 drop in Tauri:', {
          uriList,
          textData,
          extractedPaths: paths,
          fileCount: e.dataTransfer.files.length,
          fileSizes: Array.from(e.dataTransfer.files).map((f) => f.size),
        });

        if (paths.length > 0) {
          const checks = await Promise.all(
            paths.map(async (p) => ({
              path: p,
              isDir: await isDirectory(p),
            })),
          );
          const filePaths = checks.filter((c) => !c.isDir).map((c) => c.path);
          const dirPaths = checks.filter((c) => c.isDir).map((c) => c.path);
          if (filePaths.length > 0) addFilePaths(filePaths);
          if (dirPaths.length > 0) handleDroppedFolders(dirPaths);
          return;
        }

        // Fallback: Finder drops may provide File objects without text URIs.
        // The submit path will upload via /files/attachment-save (multipart),
        // which means the file has to fit the in-memory cap. For large
        // videos, ask the user to use the file picker (which goes through
        // the path-based copy branch and supports 4 GB).
        if (e.dataTransfer.files.length > 0) {
          await addFiles(e.dataTransfer.files);
        }
        return;
      }

      const files = e.dataTransfer.files;
      if (files && files.length > 0) await addFiles(files);
    },
    [disabled, addFiles, addFilePaths, handleDroppedFolders],
  );

  const handleOpenWorkDir = useCallback(
    async (workDir: string | null | undefined) => {
      if (!workDir) return;
      try {
        const response = await fetch(`${API_BASE_URL}/files/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: workDir }),
        });
        const data = await response.json();
        if (!data.success && import.meta.env.DEV)
          console.error('[ChatInput] Failed to open folder:', data.error);
      } catch {
        try {
          await navigator.clipboard.writeText(workDir);
        } catch (clipErr) {
          if (import.meta.env.DEV)
            console.error('[ChatInput] Failed to copy path:', clipErr);
        }
      }
    },
    [],
  );

  return {
    attachments,
    setAttachments,
    isDragOver,
    fileInputRef,
    pendingDropFolders,
    dropFolderDialogOpen,
    addFiles,
    removeAttachment,
    handleFileChange,
    handlePaste,
    openFilePicker,
    handleDropFolderDialogResult,
    handleOpenWorkDir,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  };
}
