/**
 * Open a design project in a local editor / file manager (Fix-sync Phase 05).
 *
 * Hand-off lets the user continue a design project as code. Security: the
 * editor id is validated against a fixed allow-list mapping to constant binary
 * names — user input never reaches the command line — and the launched
 * directory is always the project root from `getProjectDir` (derived from the
 * validated project id, not a caller-supplied path). Spawned with
 * `shell: false`.
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getProjectDir } from '@/shared/services/design-mode/fs';
import { createLogger } from '@/shared/utils/logger';

const execFileAsync = promisify(execFile);
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

async function isOnPath(bin: string): Promise<boolean> {
  const finder = platform() === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(finder, [bin]);
    return true;
  } catch {
    return false;
  }
}

/** Whether a macOS `.app` bundle exists in a standard Applications location. */
function macAppInstalled(app: string): boolean {
  if (platform() !== 'darwin') return false;
  return [
    `/Applications/${app}.app`,
    `/System/Applications/${app}.app`,
    `/System/Applications/Utilities/${app}.app`,
    path.join(homedir(), 'Applications', `${app}.app`),
  ].some((candidate) => existsSync(candidate));
}

async function editorAvailable(editor: {
  bin?: string;
  macApp?: string;
}): Promise<boolean> {
  if (editor.bin) return isOnPath(editor.bin);
  if (editor.macApp) return macAppInstalled(editor.macApp);
  return false;
}

function fileManager(): string {
  switch (platform()) {
    case 'darwin':
      return 'open';
    case 'win32':
      return 'explorer';
    default:
      return 'xdg-open';
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
    spawn(fileManager(), [root], { detached: true, stdio: 'ignore' }).unref();
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
  // `bin` editors take the dir as their first arg; `macApp` editors launch via
  // `open -a <App> <dir>`. Both spawn with `shell: false` and constant argv —
  // only the resolved project root (path-escape-checked) is dynamic.
  const [cmd, args] = editor.bin
    ? [editor.bin, [root]]
    : ['open', ['-a', editor.macApp as string, root]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  logger.info(`[${projectId}] opened ${root} in ${editor.label}`);
}
