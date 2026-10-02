import type { ArtifactType } from '@/components/artifacts';
import { API_BASE_URL } from '@/config';

// File types that should NOT read content (binary/streaming files)
export const SKIP_CONTENT_TYPES: ArtifactType[] = [
  'audio',
  'video',
  'font',
  'image',
  'pdf',
  'spreadsheet',
  'presentation',
  'document',
];

// Max file size for text content preview (10MB)
export const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024;

// Check file size via API
export async function checkFileSize(
  filePath: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/files/stat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: filePath }),
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.exists && data.size !== undefined) {
      return data.size;
    }
    return null;
  } catch {
    return null;
  }
}

// Read file content via API with optional abort signal
export async function readFileContent(
  filePath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/files/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: filePath }),
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.success && data.content !== undefined) {
      return data.content;
    }
    return null;
  } catch (err) {
    // Don't log abort errors
    if (err instanceof Error && err.name === 'AbortError') {
      return null;
    }
    return null;
  }
}

// File Tree Item Component for recursive directory display
