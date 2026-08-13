import { useEffect, useMemo, useState } from 'react';

import {
  getArtifactTypeFromExt,
  getFileExtension,
} from '@/components/artifacts';
import { shouldTreatArtifactAsOutput } from '@/components/artifacts/output-classification';
import type { Artifact } from '@/components/artifacts/types';
import { getFilesByTaskId } from '@/shared/db/database';
import type { LibraryFile } from '@/shared/db/types';
import {
  inferTaskFileRunId,
  isPromotedInputPath,
  libraryFileToTaskFile,
} from '@/shared/lib/task-files';
import { useTaskFiles, useThreadStore } from '@/shared/stores/thread-store';
import type { TaskFile } from '@/shared/stores/thread-store';

/** Map a LibraryFile.type to the Artifact type union. */
function toArtifactType(fileType: LibraryFile['type']): Artifact['type'] {
  switch (fileType) {
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'document':
      return 'document';
    case 'presentation':
      return 'presentation';
    case 'spreadsheet':
      return 'spreadsheet';
    case 'code':
      return 'code';
    case 'website':
      return 'html';
    case 'text':
    default:
      return 'text';
  }
}

function libraryFileToArtifact(file: LibraryFile): Artifact {
  // Prefer extension-based type (e.g. .txt → 'text') over stored DB type
  // to avoid routing plain-text files to DocxPreview
  const ext = getFileExtension(file.name);
  const extType = ext ? getArtifactTypeFromExt(ext) : undefined;
  const type = extType ?? toArtifactType(file.type);
  const artifact: Artifact = {
    id: String(file.id),
    name: file.name,
    type,
    path: file.path,
    content: file.preview ?? undefined,
    runId: inferTaskFileRunId(file.path),
    isSourceAttachment: isPromotedInputPath(file.path),
  };
  return {
    ...artifact,
    isOutput: shouldTreatArtifactAsOutput(artifact),
  };
}

function taskFileToArtifact(file: TaskFile): Artifact {
  const ext = getFileExtension(file.name);
  const extType = ext ? getArtifactTypeFromExt(ext) : undefined;
  const type = extType ?? taskFileKindToArtifactType(file.kind);
  const artifact: Artifact = {
    id: file.id,
    name: file.name,
    type,
    path: file.path,
    content: file.preview ?? undefined,
    fileSize: file.sizeBytes,
    runId: file.runId ?? inferTaskFileRunId(file.path),
    sourceToolCallId: file.sourceToolCallId,
    isSourceAttachment: file.role === 'input' || isPromotedInputPath(file.path),
  };
  return {
    ...artifact,
    isOutput: shouldTreatArtifactAsOutput(artifact),
  };
}

function taskFileKindToArtifactType(kind: TaskFile['kind']): Artifact['type'] {
  switch (kind) {
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'presentation':
      return 'presentation';
    case 'spreadsheet':
      return 'spreadsheet';
    case 'code':
      return 'code';
    case 'html':
      return 'html';
    case 'doc':
    case 'pdf':
      return 'document';
    case 'text':
    case 'other':
    default:
      return 'text';
  }
}

/**
 * Loads artifacts for the V2 route from the database.
 * Refreshes whenever `taskId` changes or a `task-files-updated` event fires.
 */
export function useV2Artifacts(taskId: string): Artifact[] {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const cachedFiles = useTaskFiles(taskId);
  const setFiles = useThreadStore((s) => s.setFiles);
  const hasFileIndex = useThreadStore((s) => s.threads[taskId] !== undefined);

  const cachedArtifacts = useMemo(
    () => cachedFiles.map(taskFileToArtifact),
    [cachedFiles],
  );

  useEffect(() => {
    let cancelled = false;
    setArtifacts([]);

    async function load() {
      try {
        const files = await getFilesByTaskId(taskId);
        if (!cancelled) {
          setFiles(taskId, files.map(libraryFileToTaskFile));
          setArtifacts(files.map(libraryFileToArtifact));
        }
      } catch {
        // non-critical — artifacts panel is optional
      }
    }

    void load();

    // Re-load when files are added/updated during the session
    function handleUpdate() {
      void load();
    }
    window.addEventListener('task-files-updated', handleUpdate);

    return () => {
      cancelled = true;
      window.removeEventListener('task-files-updated', handleUpdate);
    };
  }, [taskId, setFiles]);

  return hasFileIndex ? cachedArtifacts : artifacts;
}
