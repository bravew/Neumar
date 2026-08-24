import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Open the OS file manager, selecting `filePath` if the platform supports it
 * (macOS, Windows) or just opening its containing folder (Linux, where no
 * `xdg-open` equivalent exists for "select this item").
 *
 * Uses `execFile` with an argument array, never a shell string, so a path
 * containing quotes or shell metacharacters can't inject a command.
 */
export async function revealInFileManager(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-R', resolved]);
    return;
  }
  if (process.platform === 'win32') {
    // Explorer takes `/select,<path>` as one argument (no space after the
    // comma) — this is not shell-interpreted, so the path is passed as-is.
    // explorer.exe is documented to return a non-zero exit code on success
    // in some Windows versions, so a rejection here doesn't mean it failed.
    await execFileAsync('explorer', [`/select,${resolved}`]).catch(() => {});
    return;
  }
  await execFileAsync('xdg-open', [path.dirname(resolved)]);
}
