/**
 * Launch a GUI editor without tying its lifetime to the API process.
 *
 * Two failure modes made Cursor/VS Code open and immediately quit:
 *  1. `child_process.exec()` waits on a shell. Electron editors started that
 *     way stay in the shell's process group, so when the request handler
 *     finishes (or the shell exits) they receive SIGHUP and close.
 *  2. If the API was started from Cursor/VS Code (dev `pnpm dev:api`), the
 *     child inherits `ELECTRON_RUN_AS_NODE`, `VSCODE_IPC_HOOK`, etc. The
 *     `cursor` CLI then either runs as Node and exits, or a new GUI instance
 *     flashes and hands off to the parent via the inherited IPC hook.
 *
 * On macOS, Launch Services (`open -a`) avoids the `ELECTRON_RUN_AS_NODE=1`
 * CLI shim entirely. Everywhere else we spawn detached with a sanitized env.
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** CLI name → macOS .app name for editors that ship an Electron GUI. */
export const ELECTRON_EDITOR_MAC_APPS: Record<string, string> = {
  cursor: 'Cursor',
  code: 'Visual Studio Code',
  'code-insiders': 'Visual Studio Code - Insiders',
  windsurf: 'Windsurf',
  zed: 'Zed',
  subl: 'Sublime Text',
  atom: 'Atom',
};

export interface EditorLaunchSpec {
  command: string;
  args: string[];
  shell?: boolean;
}

/**
 * Copy `source` and drop Electron / VS Code / Cursor IPC variables so a
 * spawned GUI does not inherit the parent editor's runtime.
 */
export function editorLaunchEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('ELECTRON_') ||
      key.startsWith('VSCODE_') ||
      key.startsWith('CURSOR_')
    ) {
      delete env[key];
    }
  }
  return env;
}

export function macAppInstalled(
  app: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'darwin') return false;
  return [
    `/Applications/${app}.app`,
    `/System/Applications/${app}.app`,
    `/System/Applications/Utilities/${app}.app`,
    path.join(homedir(), 'Applications', `${app}.app`),
  ].some((candidate) => existsSync(candidate));
}

export async function isOnPath(bin: string): Promise<boolean> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(finder, [bin]);
    return true;
  } catch {
    return false;
  }
}

/** True if the CLI is on PATH, or (macOS) the matching .app is installed. */
export async function isEditorCommandAvailable(bin: string): Promise<boolean> {
  if (await isOnPath(bin)) return true;
  const app = ELECTRON_EDITOR_MAC_APPS[bin];
  return Boolean(app && macAppInstalled(app));
}

export function resolveEditorLaunch(
  command: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): EditorLaunchSpec {
  if (platform === 'darwin') {
    const app = ELECTRON_EDITOR_MAC_APPS[command];
    if (app) {
      return { command: 'open', args: ['-a', app, targetPath] };
    }
  }
  if (platform === 'win32') {
    // `.cmd` shims (cursor.cmd, code.cmd) require a shell on Windows.
    return { command, args: [targetPath], shell: true };
  }
  return { command, args: [targetPath] };
}

export function launchDetached(
  command: string,
  args: string[],
  options: { shell?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env: editorLaunchEnv(),
      windowsHide: true,
      shell: options.shell === true,
    });
    const onError = (err: Error) => {
      child.off('spawn', onSpawn);
      reject(err);
    };
    const onSpawn = () => {
      child.off('error', onError);
      child.unref();
      resolve();
    };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

/** Open `targetPath` in the given editor CLI (cursor, code, …). */
export async function openPathInEditor(
  cliCommand: string,
  targetPath: string,
): Promise<void> {
  const spec = resolveEditorLaunch(cliCommand, targetPath);
  await launchDetached(spec.command, spec.args, { shell: spec.shell });
}
