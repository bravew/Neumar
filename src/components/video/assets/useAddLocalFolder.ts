import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';

import {
  lastPathSegment,
  pickLocalFolder,
} from '@/components/video/LinkedSourcesPanel';
import { acquireAssetMaterializationLease } from '@/shared/assets/materializationLease';
import { grantFileReadAccess } from '@/shared/lib/tauri-scope';

import type { VideoProjectEditorActions } from '../editorTypes';

const CRAWL_POLL_INTERVAL_MS = 1200;
const CRAWL_MAX_POLLS = 25;
// Local-fs crawling has no completion event today (see
// dev-doc/video-mode/14-08-24-editor-ux-feedback/README.md, item 1) — treat
// the discovered-asset count settling across two consecutive polls as "the
// crawl is done" instead of a hard signal.
const CRAWL_STABLE_POLLS = 2;

// AppleDouble resource forks (`._Clip.MP4`, written beside every file when a
// folder was copied to a non-HFS volume like an exFAT SD card) and OS
// bookkeeping files carry a real media extension and can slip past the
// backend crawler's own filter, so the attach step re-checks defensively
// rather than trusting every discovered item.
const OS_METADATA_FILENAMES = new Set(['thumbs.db', 'desktop.ini']);
// AppleDouble forks are typically exactly 4096 bytes; no genuine video or
// image file is ever this small, so anything under this floor is dropped.
const MIN_MEDIA_BYTES = 16 * 1024;

function isSupportedLinkedAsset(asset: {
  name: string;
  kind: string;
  sizeBytes?: number;
}): boolean {
  if (asset.name.startsWith('.')) return false;
  if (OS_METADATA_FILENAMES.has(asset.name.toLowerCase())) return false;
  if (
    (asset.kind === 'video' || asset.kind === 'image') &&
    typeof asset.sizeBytes === 'number' &&
    asset.sizeBytes > 0 &&
    asset.sizeBytes < MIN_MEDIA_BYTES
  ) {
    return false;
  }
  return true;
}

export interface AddLocalFolderLabels {
  attachSucceededToast: string;
  attachPartialToast: string;
  materializeFailed: string;
  folderIndexing: string;
  folderAttaching: string;
  folderEmpty: string;
  folderSkippedUnsupported: string;
}

export interface AddLocalFolderProgress {
  label: string;
}

export function useAddLocalFolder(
  actions: VideoProjectEditorActions,
  pickerTitle: string,
  labels: AddLocalFolderLabels,
  sessionId?: string,
): {
  addingFolder: boolean;
  addLocalFolder: () => Promise<void>;
  progress: AddLocalFolderProgress | null;
} {
  const [addingFolder, setAddingFolder] = useState(false);
  const [progress, setProgress] = useState<AddLocalFolderProgress | null>(null);
  // Re-arm on every mount: React 19 StrictMode mounts, unmounts, then mounts
  // again in dev, so a cleanup-only effect would leave this false forever —
  // which silently swallowed the toast and left `addingFolder` stuck true,
  // disabling the "Add folder" menu item permanently after the first click.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const addLocalFolder = useCallback(async () => {
    setAddingFolder(true);
    let releaseLease = () => {};
    try {
      const selected = await pickLocalFolder(pickerTitle);
      if (!selected) return;
      // Only after the chooser closes — see the same note in useAddLocalFiles.
      releaseLease = acquireAssetMaterializationLease(sessionId);
      const folderName = lastPathSegment(selected);
      await grantFileReadAccess([selected]);
      const grant = await actions.grantLocalFolder(selected);
      const added = await actions.addLinkedSource({
        provider: 'local-fs',
        rootPath: grant.rootPath,
        displayName: folderName,
        role: 'context',
        localGrantToken: grant.token,
        filters: { types: ['image', 'video', 'audio'] },
      });
      const source = added?.source;
      if (!source) return;

      setProgress({
        label: labels.folderIndexing.replace('{name}', folderName),
      });
      // A freshly added source is `index.state: 'unindexed'` and nothing
      // crawls it on its own — kick off the sync now, otherwise the folder's
      // media never gets indexed and never surfaces in search/browse.
      await actions.syncLinkedSource(source.id);
      const crawled = await waitForCrawl(actions, source.id, mountedRef);
      const discovered = crawled.filter(isSupportedLinkedAsset);
      const skippedCount = crawled.length - discovered.length;
      if (skippedCount > 0 && mountedRef.current) {
        toast.info(
          labels.folderSkippedUnsupported.replace(
            '{count}',
            String(skippedCount),
          ),
        );
      }

      if (discovered.length === 0) {
        if (mountedRef.current) {
          toast.info(labels.folderEmpty.replace('{name}', folderName));
        }
        return;
      }

      let attached = 0;
      let firstError: string | null = null;
      for (const linkedAsset of discovered) {
        if (mountedRef.current) {
          setProgress({
            label: labels.folderAttaching
              .replace('{current}', String(attached))
              .replace('{total}', String(discovered.length))
              .replace('{name}', folderName),
          });
        }
        try {
          await actions.attachLinkedAsset(linkedAsset.id, undefined, sessionId);
          attached += 1;
        } catch (error) {
          firstError ??= error instanceof Error ? error.message : String(error);
        }
      }

      if (!mountedRef.current) return;
      if (attached === discovered.length) {
        toast.success(
          labels.attachSucceededToast.replace('{count}', String(attached)),
        );
      } else if (attached === 0) {
        toast.error(
          labels.materializeFailed.replace('{message}', firstError ?? ''),
        );
      } else {
        toast.warning(
          labels.attachPartialToast
            .replace('{succeeded}', String(attached))
            .replace('{failed}', String(discovered.length - attached)),
        );
      }
    } catch (err) {
      if (mountedRef.current) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      releaseLease();
      if (mountedRef.current) {
        setAddingFolder(false);
        setProgress(null);
      }
    }
  }, [actions, labels, pickerTitle, sessionId]);

  return { addingFolder, addLocalFolder, progress };
}

async function waitForCrawl(
  actions: VideoProjectEditorActions,
  sourceId: string,
  mountedRef: { current: boolean },
): Promise<
  Awaited<ReturnType<VideoProjectEditorActions['listLinkedAssets']>>['assets']
> {
  let previousCount = -1;
  let stableStreak = 0;
  let latest: Awaited<
    ReturnType<VideoProjectEditorActions['listLinkedAssets']>
  >['assets'] = [];
  for (let attempt = 0; attempt < CRAWL_MAX_POLLS; attempt += 1) {
    if (!mountedRef.current) return latest;
    const result = await actions.listLinkedAssets({ sourceId, limit: 500 });
    latest = result.assets;
    // Only a non-zero count that stops growing counts as "done" — an empty
    // result could just mean the crawl hasn't found its first file yet, so
    // zero never short-circuits the wait; a genuinely empty folder rides out
    // the full poll budget below before we conclude that.
    if (latest.length > 0 && latest.length === previousCount) {
      stableStreak += 1;
      if (stableStreak >= CRAWL_STABLE_POLLS) return latest;
    } else {
      stableStreak = 0;
    }
    previousCount = latest.length;
    await new Promise((resolve) => setTimeout(resolve, CRAWL_POLL_INTERVAL_MS));
  }
  return latest;
}
