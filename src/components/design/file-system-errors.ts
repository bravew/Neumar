import { DesignApiError } from '@/shared/hooks/useDesignMode';

export type FileSystemErrorCode =
  | 'not-found'
  | 'permission-denied'
  | 'too-large'
  | 'aborted'
  | 'unknown';

export interface FileSystemReadError {
  code: FileSystemErrorCode;
  message: string;
}

export function classifyFileSystemReadError(
  error: unknown,
): FileSystemReadError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'aborted', message: error.message };
  }
  if (error instanceof DesignApiError) {
    return {
      code: statusToCode(error.status),
      message: error.message,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: messageToCode(message), message };
}

function statusToCode(status: number): FileSystemErrorCode {
  if (status === 404) return 'not-found';
  if (status === 401 || status === 403) return 'permission-denied';
  if (status === 413) return 'too-large';
  return 'unknown';
}

function messageToCode(message: string): FileSystemErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes('not found') || lower.includes('enoent')) {
    return 'not-found';
  }
  if (
    lower.includes('permission') ||
    lower.includes('eacces') ||
    lower.includes('eperm')
  ) {
    return 'permission-denied';
  }
  if (lower.includes('too large')) return 'too-large';
  return 'unknown';
}
