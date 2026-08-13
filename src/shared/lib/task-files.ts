import type { LibraryFile } from '@/shared/db/types';
import type { TaskFile } from '@/shared/stores/thread-store';

export function libraryFileToTaskFile(file: LibraryFile): TaskFile {
  const role = isPromotedInputPath(file.path) ? 'input' : undefined;
  return {
    id: String(file.id),
    taskId: file.task_id,
    name: file.name,
    path: file.path,
    kind: libraryFileTypeToTaskFileKind(file.type),
    createdAt: file.created_at,
    runId: inferTaskFileRunId(file.path),
    role,
    preview: file.preview,
    thumbnail: file.thumbnail,
  };
}

export function inferTaskFileRunId(
  path: string | undefined,
): string | undefined {
  return path?.match(/[\\/]output[\\/]([^\\/]+)[\\/]/i)?.[1];
}

export function isPromotedInputPath(path: string | undefined): boolean {
  return /[\\/]output[\\/][^\\/]+[\\/]inputs[\\/]/i.test(path ?? '');
}

export function libraryFileTypeToTaskFileKind(
  type: LibraryFile['type'],
): TaskFile['kind'] {
  switch (type) {
    case 'image':
    case 'video':
    case 'audio':
    case 'code':
    case 'text':
    case 'presentation':
    case 'spreadsheet':
      return type;
    case 'website':
      return 'html';
    case 'document':
      return 'doc';
    default:
      return 'other';
  }
}
