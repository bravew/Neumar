import { validatePath } from '@/shared/services/ffmpeg';
import { getVideoWorkspaceRoot } from '@/shared/video/store';

export function assertVideoWorkspacePath(filePath: string): string {
  return validatePath(filePath, getVideoWorkspaceRoot(), 'read');
}
