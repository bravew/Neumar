import { execFile } from 'node:child_process';

/**
 * Backend-spawned native OS folder picker.
 *
 * The web build (`localhost:3420`) has no native folder dialog — the browser
 * File System Access API yields a sandboxed handle, not a path the Node
 * indexer can read. Because the API server runs on the user's own machine
 * (dev server and, in production, the Tauri sidecar), it can spawn the real OS
 * folder chooser and hand back an absolute path the linked-source crawler can
 * index directly. The Tauri webview keeps using `@tauri-apps/plugin-dialog`;
 * this route is the parity path for plain browsers.
 *
 * The prompt text is a fixed constant — never interpolate caller input into
 * the osascript/zenity invocation, which would be a shell-injection vector.
 */

const DIALOG_PROMPT = 'Select a folder of media to link';
const FILE_DIALOG_PROMPT = 'Select media files to add';
const DIALOG_TIMEOUT_MS = 120_000;

export interface NativeFolderDialogCommand {
  command: string;
  args: string[];
}

export interface NativeFolderDialogResult {
  /** False when the platform has no usable native folder dialog. */
  supported: boolean;
  /** Chosen absolute path, or null when the user cancelled. */
  path: string | null;
}

interface ExecResult {
  error: NodeJS.ErrnoException | null;
  stdout: string;
}

export type FolderDialogExec = (
  command: string,
  args: string[],
) => Promise<ExecResult>;

// PowerShell FolderBrowserDialog, raised TopMost so it surfaces above the
// browser instead of opening behind it.
const WINDOWS_FOLDER_DIALOG_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  '$owner = New-Object System.Windows.Forms.Form;',
  '$owner.TopMost = $true;',
  '$owner.ShowInTaskbar = $false;',
  "$owner.StartPosition = 'CenterScreen';",
  '$owner.Width = 1; $owner.Height = 1;',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
  `$dialog.Description = '${DIALOG_PROMPT}';`,
  '$dialog.ShowNewFolderButton = $true;',
  'try {',
  '  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }',
  '} finally { $owner.Dispose(); }',
].join(' ');

// AppleScript returns a list, not a string, so the chosen files are joined
// into one newline-separated blob the caller can split.
const MACOS_FILE_DIALOG_SCRIPT = [
  `set chosen to choose file with prompt "${FILE_DIALOG_PROMPT}" with multiple selections allowed`,
  'set out to ""',
  'repeat with item_ref in chosen',
  '  set out to out & POSIX path of item_ref & linefeed',
  'end repeat',
  'return out',
].join('\n');

const WINDOWS_FILE_DIALOG_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  '$owner = New-Object System.Windows.Forms.Form;',
  '$owner.TopMost = $true;',
  '$owner.ShowInTaskbar = $false;',
  "$owner.StartPosition = 'CenterScreen';",
  '$owner.Width = 1; $owner.Height = 1;',
  '$dialog = New-Object System.Windows.Forms.OpenFileDialog;',
  `$dialog.Title = '${FILE_DIALOG_PROMPT}';`,
  '$dialog.Multiselect = $true;',
  'try {',
  '  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.FileNames -join [Environment]::NewLine }',
  '} finally { $owner.Dispose(); }',
].join(' ');

/**
 * Same idea as the folder picker: the API server runs on the user's machine,
 * so it can raise the real OS file chooser and hand back absolute paths. That
 * is what lets the web build add media by reference — a browser `File` carries
 * bytes but no path, so an upload is the only other option.
 */
export function buildFileDialogCommand(
  platform: NodeJS.Platform,
): NativeFolderDialogCommand | null {
  if (platform === 'darwin') {
    return { command: 'osascript', args: ['-e', MACOS_FILE_DIALOG_SCRIPT] };
  }
  if (platform === 'linux') {
    return {
      command: 'zenity',
      args: [
        '--file-selection',
        '--multiple',
        '--separator=\n',
        `--title=${FILE_DIALOG_PROMPT}`,
      ],
    };
  }
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-Sta', '-Command', WINDOWS_FILE_DIALOG_SCRIPT],
    };
  }
  return null;
}

/** Splits dialog stdout into absolute paths; empty on cancel or error. */
export function parseFileDialogResult(
  error: NodeJS.ErrnoException | null,
  stdout: string,
): string[] {
  if (error) return [];
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Spawns the OS-native file picker. `exec`/`platform` are injectable. */
export async function openNativeFileDialog(
  options: { platform?: NodeJS.Platform; exec?: FolderDialogExec } = {},
): Promise<{ supported: boolean; paths: string[] }> {
  const platform = options.platform ?? process.platform;
  const command = buildFileDialogCommand(platform);
  if (!command) return { supported: false, paths: [] };

  const exec = options.exec ?? defaultExec;
  const { error, stdout } = await exec(command.command, command.args);
  if (error?.code === 'ENOENT') return { supported: false, paths: [] };

  return { supported: true, paths: parseFileDialogResult(error, stdout) };
}

/** Resolves the platform-specific dialog command, or null if unsupported. */
export function buildFolderDialogCommand(
  platform: NodeJS.Platform,
): NativeFolderDialogCommand | null {
  if (platform === 'darwin') {
    // `choose folder` presents the standard navigation panel, which takes key
    // focus reliably and already includes an inline "New Folder" button.
    return {
      command: 'osascript',
      args: [
        '-e',
        `POSIX path of (choose folder with prompt "${DIALOG_PROMPT}")`,
      ],
    };
  }
  if (platform === 'linux') {
    return {
      command: 'zenity',
      args: ['--file-selection', '--directory', `--title=${DIALOG_PROMPT}`],
    };
  }
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-Sta', '-Command', WINDOWS_FOLDER_DIALOG_SCRIPT],
    };
  }
  return null;
}

/** Normalizes dialog stdout into an absolute path, or null on cancel/error. */
export function parseFolderDialogResult(
  error: NodeJS.ErrnoException | null,
  stdout: string,
): string | null {
  // A non-zero exit is how every dialog reports "user cancelled".
  if (error) return null;
  const trimmed = stdout.trim().replace(/[/\\]+$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

function defaultExec(command: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: DIALOG_TIMEOUT_MS }, (error, stdout) => {
      resolve({
        error: error as NodeJS.ErrnoException | null,
        stdout: stdout?.toString() ?? '',
      });
    });
  });
}

/**
 * Spawns the OS-native folder picker and waits for the user's choice.
 * `exec`/`platform` are injectable for tests.
 */
export async function openNativeFolderDialog(
  options: { platform?: NodeJS.Platform; exec?: FolderDialogExec } = {},
): Promise<NativeFolderDialogResult> {
  const platform = options.platform ?? process.platform;
  const command = buildFolderDialogCommand(platform);
  if (!command) return { supported: false, path: null };

  const exec = options.exec ?? defaultExec;
  const { error, stdout } = await exec(command.command, command.args);
  // A missing dialog binary (e.g. zenity not installed) is "unsupported", not
  // a cancel — so the client falls back to manual path entry instead of
  // silently looking like the user dismissed a picker that never opened.
  if (error?.code === 'ENOENT') return { supported: false, path: null };

  return { supported: true, path: parseFolderDialogResult(error, stdout) };
}
