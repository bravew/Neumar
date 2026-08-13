import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';

import {
  lastPathSegment,
  pickLocalFolder,
} from '@/components/video/LinkedSourcesPanel';
import { grantFileReadAccess } from '@/shared/lib/tauri-scope';

import type { VideoProjectEditorActions } from '../editorTypes';

export function useAddLocalFolder(
  actions: VideoProjectEditorActions,
  pickerTitle: string,
): { addingFolder: boolean; addLocalFolder: () => Promise<void> } {
  const [addingFolder, setAddingFolder] = useState(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const addLocalFolder = useCallback(async () => {
    setAddingFolder(true);
    try {
      const selected = await pickLocalFolder(pickerTitle);
      if (!selected) return;
      await grantFileReadAccess([selected]);
      const grant = await actions.grantLocalFolder(selected);
      const added = await actions.addLinkedSource({
        provider: 'local-fs',
        rootPath: grant.rootPath,
        displayName: lastPathSegment(grant.rootPath),
        role: 'context',
        localGrantToken: grant.token,
        filters: { types: ['image', 'video'] },
      });
      // A freshly added source is `index.state:'unindexed'` and nothing crawls
      // it on its own — kick off the sync now, otherwise the folder's media
      // never gets indexed and never surfaces in search/browse.
      if (added?.source) await actions.syncLinkedSource(added.source.id);
      if (mountedRef.current) toast.success(lastPathSegment(grant.rootPath));
    } catch (err) {
      if (mountedRef.current) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) setAddingFolder(false);
    }
  }, [actions, pickerTitle]);

  return { addingFolder, addLocalFolder };
}
