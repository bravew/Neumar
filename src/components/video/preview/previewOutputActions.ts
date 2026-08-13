import { API_BASE_URL } from '@/config';
import { APP_DATA_DIR } from '@/config/branding';
import { getSettings } from '@/shared/db/settings';
import { expandPath } from '@/shared/lib/paths';
import type { VideoProject, VideoRenderOutput } from '@/shared/types/video';
import { isTauriRuntime } from '@/shared/utils/tauri';

export function renderedOutputUrl(
  project: Pick<VideoProject, 'id' | 'render'>,
  selectedOutput?: Pick<VideoRenderOutput, 'aspectRatio'>,
): string {
  const params = new URLSearchParams();
  if (selectedOutput?.aspectRatio) {
    params.set('aspectRatio', selectedOutput.aspectRatio);
  }
  if (project.render?.updatedAt) {
    params.set('v', project.render.updatedAt);
  }
  const query = params.toString();
  return `${API_BASE_URL}/video/projects/${encodeURIComponent(project.id)}/output${
    query ? `?${query}` : ''
  }`;
}

export async function openRenderedOutput(
  project: VideoProject,
  selectedOutput?: VideoRenderOutput,
): Promise<void> {
  const relativePath =
    selectedOutput?.path ?? project.render?.outputPath ?? undefined;
  if (!relativePath) return;
  if (!isTauriRuntime()) {
    window.open(
      renderedOutputUrl(project, selectedOutput),
      '_blank',
      'noopener,noreferrer',
    );
    return;
  }
  const settings = getSettings();
  const workDir = settings.workDir || `~/${APP_DATA_DIR}`;
  const expandedWorkDir = await expandPath(workDir);
  const absolutePath = relativePath.startsWith('/')
    ? relativePath
    : `${expandedWorkDir}/${relativePath}`;
  const response = await fetch(`${API_BASE_URL}/files/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: absolutePath }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
