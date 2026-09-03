/**
 * Open a design project in a local editor / file manager (Fix-sync Phase 05).
 *
 * Hand-off lets the user continue a design project as code. Security: the
 * editor id is validated against a fixed allow-list mapping to constant binary
 * names — user input never reaches the command line — and the launched
 * directory is always the project root from `getProjectDir` (derived from the
 * validated project id, not a caller-supplied path). Spawned with
 * `shell: false` (except Windows `.cmd` shims inside `openPathInEditor`).
 */

import { getProjectDir } from '@/shared/services/design-mode/fs';
import {
  isEditorCommandAvailable,
  launchDetached,
  macAppInstalled,
  openPathInEditor,
} from '@/shared/utils/launch-editor';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DesignEditors');

/**
 * Fixed allow-list mapping an editor id to a constant launch target (never user
 * input). `bin` editors launch via a PATH binary (cross-platform); `macApp`
 * editors launch via `open -a <App>` and are macOS-only — used for GUI apps
 * that don't ship a CLI shim (Xcode, Terminal, Warp).
 */
const EDITORS: Record<
  string,
  { label: string; bin?: string; macApp?: string }
> = {
  cursor: { label: 'Cursor', bin: 'cursor' },
  vscode: { label: 'VS Code', bin: 'code' },
  zed: { label: 'Zed', bin: 'zed' },
  windsurf: { label: 'Windsurf', bin: 'windsurf' },
  xcode: { label: 'Xcode', macApp: 'Xcode' },
  terminal: { label: 'Terminal', macApp: 'Terminal' },
  warp: { label: 'Warp', macApp: 'Warp' },
};

export interface DesignEditor {
  id: string;
  label: string;
  available: boolean;
}

async function editorAvailable(editor: {
  bin?: string;
  macApp?: string;
}): Promise<boolean> {
  if (editor.bin) return isEditorCommandAvailable(editor.bin);
  if (editor.macApp) return macAppInstalled(editor.macApp);
  return false;
}

function fileManager(): { command: string; args: (root: string) => string[] } {
  switch (process.platform) {
    case 'darwin':
      return { command: 'open', args: (root) => [root] };
    case 'win32':
      return { command: 'explorer', args: (root) => [root] };
    default:
      return { command: 'xdg-open', args: (root) => [root] };
  }
}

/** Absolute path of a project's root directory (for copy-path / CLI hand-off). */
export function designProjectDir(projectId: string): string {
  return getProjectDir(projectId);
}

/** List known editors with availability, plus the always-present file manager. */
export async function detectDesignEditors(): Promise<DesignEditor[]> {
  const editors: DesignEditor[] = [];
  for (const [id, editor] of Object.entries(EDITORS)) {
    editors.push({
      id,
      label: editor.label,
      available: await editorAvailable(editor),
    });
  }
  editors.push({ id: 'reveal', label: 'File manager', available: true });
  return editors;
}

/** Launch the project directory in the requested editor / file manager. */
export async function openDesignProjectInEditor(
  projectId: string,
  editorId: string,
): Promise<void> {
  const root = getProjectDir(projectId);

  if (editorId === 'reveal') {
    const manager = fileManager();
    await launchDetached(manager.command, manager.args(root));
    logger.info(`[${projectId}] revealed ${root} in file manager`);
    return;
  }

  const editor = EDITORS[editorId];
  if (!editor) {
    throw new Error(`Unknown editor: ${editorId}`);
  }
  if (!(await editorAvailable(editor))) {
    const err = new Error(`${editor.label} is not installed`);
    (err as Error & { code?: string }).code = 'EDITOR_NOT_AVAILABLE';
    throw err;
  }
  // `bin` editors take the dir as their first arg (macOS uses `open -a` for
  // Electron apps so the process is not killed with the API shell). `macApp`
  // editors launch via `open -a <App> <dir>`. Only the resolved project root
  // (path-escape-checked) is dynamic.
  if (editor.bin) {
    await openPathInEditor(editor.bin, root);
  } else {
    await launchDetached('open', ['-a', editor.macApp as string, root]);
  }
  logger.info(`[${projectId}] opened ${root} in ${editor.label}`);
}
