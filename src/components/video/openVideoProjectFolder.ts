import { API_BASE_URL } from '@/config';
import { APP_DATA_DIR } from '@/config/branding';
import { getSettings } from '@/shared/db/settings';
import { expandPath } from '@/shared/lib/paths';

// Mirrors `assertSafeId` in src-api/.../video/store.ts — the same character
// class the backend uses to refuse path traversal in project ids. Validating
// here too means a stray caller can't paste `../something` into the path we
// hand to `/files/open`, even if a future site uses a non-server-generated id.
const SAFE_PROJECT_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * Reveal `<workspace>/videos/<projectId>/` in the system file manager via the
 * `/files/open` endpoint. Throws on transport or HTTP failure so callers can
 * surface a toast — every reveal action in this app uses the same pattern.
 */
export async function openVideoProjectFolder(projectId: string): Promise<void> {
  if (!SAFE_PROJECT_ID.test(projectId)) {
    throw new Error(`Invalid video project id: ${projectId}`);
  }
  const settings = getSettings();
  const workDir = settings.workDir || `~/${APP_DATA_DIR}`;
  const expandedWorkDir = await expandPath(workDir);
  const folderPath = `${expandedWorkDir}/videos/${projectId}`;
  const response = await fetch(`${API_BASE_URL}/files/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folderPath, createIfMissing: true }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}
