/**
 * Codex CLI Sandbox Provider
 *
 * Uses OpenAI's Codex CLI sandbox feature for isolated code execution.
 * Codex CLI provides a secure sandbox environment for running scripts.
 */

import { execSync, spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import * as path from 'path';

import { defineSandboxPlugin } from '@/core/sandbox/plugin';
import type {
  SandboxPlugin,
  SandboxProviderMetadata,
} from '@/core/sandbox/plugin';
import type {
  ISandboxProvider,
  SandboxCapabilities,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxProviderType,
  ScriptOptions,
  VolumeMount,
} from '@/core/sandbox/types';

import { getAppDir } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

// Allow scoped npm names (`@scope/pkg`), version specifiers (`pkg@1.2.3`,
// `pkg>=1.0`, `pkg~=2.0`), extras (`pkg[extra]`), local paths and
// dotted-relative paths. Reject anything that could shell-quote out
// (whitespace, `;`, `&`, `|`, backticks, `$`, redirection).
const SAFE_PACKAGE_NAME = /^[A-Za-z0-9@_+\-./[\]~=<>!]+$/;

const logger = createLogger('CodexProvider');

/**
 * Get target triple suffix for the current platform
 * Tauri adds this suffix to externalBin files
 */
function getTargetTriple(): string {
  const os = platform();
  const arch = process.arch;

  if (os === 'darwin') {
    return arch === 'arm64' ? '-aarch64-apple-darwin' : '-x86_64-apple-darwin';
  } else if (os === 'linux') {
    return '-x86_64-unknown-linux-gnu';
  } else if (os === 'win32') {
    return '-x86_64-pc-windows-msvc';
  }
  return '';
}

/**
 * Check if Python is available on the system
 * Returns the python command to use, or undefined if not available
 */
function getPythonCommand(): string | undefined {
  const os = platform();
  const commands =
    os === 'win32' ? ['python', 'python3'] : ['python3', 'python'];

  for (const cmd of commands) {
    try {
      execSync(`${cmd} --version`, { encoding: 'utf-8', stdio: 'pipe' });
      logger.info(`Found Python: ${cmd}`);
      return cmd;
    } catch {
      // Command not found, try next
    }
  }

  logger.info('Python not found on system');
  return undefined;
}

/**
 * Get the path to the bundled Node.js (within the app bundle)
 * This allows running JS scripts without requiring user to install Node.js
 */
function getBundledNodePath(): string | undefined {
  const os = platform();
  const execDir = process.execPath ? path.dirname(process.execPath) : '';

  if (!execDir) return undefined;

  if (os === 'darwin') {
    // Check multiple locations for cli-bundle (macOS app bundle structure)
    const searchPaths = [
      // Contents/Resources/_up_/src-api/dist/cli-bundle (Tauri resources location)
      path.join(
        execDir,
        '..',
        'Resources',
        '_up_',
        'src-api',
        'dist',
        'cli-bundle',
        'node',
      ),
      // Contents/MacOS/cli-bundle (where build.sh copies it)
      path.join(execDir, 'cli-bundle', 'node'),
      // Contents/Resources/cli-bundle (standard resource location)
      path.join(execDir, '..', 'Resources', 'cli-bundle', 'node'),
    ];

    for (const nodePath of searchPaths) {
      if (existsSync(nodePath)) {
        logger.info(`Found bundled node at: ${nodePath}`);
        return nodePath;
      }
    }
  } else if (os === 'linux') {
    // Linux: check relative to execDir
    const nodePath = path.join(execDir, 'cli-bundle', 'node');
    if (existsSync(nodePath)) {
      return nodePath;
    }
  } else if (os === 'win32') {
    // Windows: check for node.exe
    const nodePath = path.join(execDir, 'cli-bundle', 'node.exe');
    if (existsSync(nodePath)) {
      return nodePath;
    }
  }

  return undefined;
}

/**
 * Get the path to the bundled codex launcher (within the app bundle)
 * Now uses unified cli-bundle that contains both Claude Code and Codex with shared Node.js
 */
function getBundledCodexPath(): string | undefined {
  const os = platform();
  const ext = os === 'win32' ? '.cmd' : '';
  const targetTriple = getTargetTriple();

  // In packaged app, codex launcher is in the same directory as the running binary
  // or in Resources directory on macOS
  const possiblePaths: string[] = [];

  // Get the directory of the current executable
  const execDir = process.execPath ? path.dirname(process.execPath) : '';

  logger.info('Searching for bundled codex...');
  logger.info(`execDir: ${execDir}`);
  logger.info(`targetTriple: ${targetTriple}`);

  if (execDir) {
    // Tauri adds target triple suffix to externalBin files
    // e.g., codex-aarch64-apple-darwin on Apple Silicon Mac
    possiblePaths.push(path.join(execDir, `codex${targetTriple}${ext}`));

    // Also try without suffix (for development or manual placement)
    possiblePaths.push(path.join(execDir, `codex${ext}`));

    // macOS app bundle: check both MacOS and Resources directories
    if (os === 'darwin') {
      const resourcesDir = path.join(execDir, '..', 'Resources');

      // Check for unified cli-bundle in multiple locations
      const cliBundlePaths = [
        // Contents/Resources/_up_/src-api/dist/cli-bundle (Tauri resources location)
        path.join(
          resourcesDir,
          '_up_',
          'src-api',
          'dist',
          'cli-bundle',
          'node',
        ),
        // Contents/MacOS/cli-bundle (where build.sh copies it)
        path.join(execDir, 'cli-bundle', 'node'),
        // Contents/Resources/cli-bundle (standard resource location)
        path.join(resourcesDir, 'cli-bundle', 'node'),
      ];

      for (const cliNodePath of cliBundlePaths) {
        if (existsSync(cliNodePath)) {
          const bundleDir = path.dirname(cliNodePath);
          logger.info(`Found cli-bundle at: ${bundleDir}`);
          // Return the launcher if it exists
          const launcherPath = path.join(execDir, `codex${targetTriple}`);
          if (existsSync(launcherPath)) {
            return launcherPath;
          }
          // Try without suffix
          const launcherPathNoSuffix = path.join(execDir, 'codex');
          if (existsSync(launcherPathNoSuffix)) {
            return launcherPathNoSuffix;
          }
          // Fallback: return path to node, caller should handle this
          return cliNodePath;
        }
      }
    }
  }

  // Development: check dist directory relative to the running binary, not
  // process.cwd() — in Tauri sidecar mode cwd is the user's workspace and the
  // dev paths below would resolve incorrectly. process.execPath points to the
  // node/sidecar binary, which sits next to the project's src-api/dist tree
  // during local dev.
  const devRootBase = execDir || path.dirname(process.execPath);
  const devRoots = [
    devRootBase,
    path.join(devRootBase, '..'),
    path.join(devRootBase, '..', '..'),
  ];
  for (const root of devRoots) {
    possiblePaths.push(path.join(root, 'src-api', 'dist', `codex${ext}`));
    possiblePaths.push(
      path.join(root, 'src-api', 'dist', `codex${targetTriple}${ext}`),
    );
  }

  logger.info(`Checking paths: ${possiblePaths.join(', ')}`);

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      logger.info(`Found bundled codex at: ${p}`);
      return p;
    }
  }

  logger.info('Bundled codex not found');
  return undefined;
}

/**
 * Get the path to the codex executable
 * Priority: CODEX_PATH env > which/where > common paths > bundled
 */
function getCodexPath(): string | undefined {
  const os = platform();

  logger.info(`getCodexPath() called, platform: ${os}, arch: ${process.arch}`);
  logger.info(`process.execPath: ${process.execPath}`);

  // Check CODEX_PATH env var first (highest priority - user override)
  if (process.env.CODEX_PATH && existsSync(process.env.CODEX_PATH)) {
    logger.info(`Using CODEX_PATH: ${process.env.CODEX_PATH}`);
    return process.env.CODEX_PATH;
  }
  logger.info('CODEX_PATH not set');

  // Try system-installed codex via which/where
  try {
    if (os === 'win32') {
      const whereResult = execSync('where codex', {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      const firstPath = whereResult.split('\n')[0];
      if (firstPath && existsSync(firstPath)) {
        logger.info(`Found system codex at: ${firstPath}`);
        return firstPath;
      }
    } else {
      const whichResult = execSync('which codex', {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      if (whichResult && existsSync(whichResult)) {
        logger.info(`Found system codex at: ${whichResult}`);
        return whichResult;
      }
    }
  } catch {
    logger.info('System codex not found via which/where');
  }

  // Check common install locations
  const commonPaths =
    os === 'win32'
      ? [path.join(homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd')]
      : [
          '/usr/local/bin/codex',
          path.join(homedir(), '.local', 'bin', 'codex'),
          path.join(homedir(), '.npm-global', 'bin', 'codex'),
        ];

  logger.info(`Checking common paths: ${commonPaths.join(', ')}`);
  for (const p of commonPaths) {
    if (existsSync(p)) {
      logger.info(`Found codex at common path: ${p}`);
      return p;
    }
  }
  logger.info('Codex not found in common paths');

  // Fallback to bundled codex (lowest priority)
  logger.info('Checking for bundled codex...');
  const bundledPath = getBundledCodexPath();
  if (bundledPath) {
    logger.info(`Using bundled codex: ${bundledPath}`);
    return bundledPath;
  }

  logger.warn('No codex found anywhere');
  return undefined;
}

export class CodexProvider implements ISandboxProvider {
  readonly type: SandboxProviderType = 'codex';
  readonly name = 'Codex CLI Sandbox';
  readonly version = '1.0.0';

  private codexPath: string | undefined;
  private volumes: VolumeMount[] = [];
  private trustedShell = false;

  async isAvailable(): Promise<boolean> {
    logger.info('Checking availability...');
    this.codexPath = getCodexPath();
    const available = this.codexPath !== undefined;
    logger.info(
      `isAvailable: ${available}, path: ${this.codexPath || 'not found'}`,
    );
    return available;
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    this.codexPath = getCodexPath();
    this.trustedShell = !!(config && config.trustedShell);
    if (!this.codexPath) {
      logger.warn(
        'Codex CLI not found. Install with: npm install -g @openai/codex',
      );
    } else {
      logger.info(`Using Codex CLI at: ${this.codexPath}`);
    }
    if (this.trustedShell) {
      logger.warn(
        'Codex provider running with trustedShell — sh -c wrapping enabled. Marketplace eligibility is forfeited.',
      );
    }
  }

  async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
    const startTime = Date.now();
    const { command, args = [], cwd, env, timeout } = options;

    if (!this.codexPath) {
      return {
        stdout: '',
        stderr: 'Codex CLI is not installed',
        exitCode: 1,
        duration: Date.now() - startTime,
      };
    }

    const workDir = cwd || getAppDir();
    const os = platform();

    // Use Codex sandbox subcommand (no API needed)
    // macOS: codex sandbox macos --full-auto -- command args
    // Linux: codex sandbox linux -- command args
    const sandboxSubcommand =
      os === 'darwin' ? 'macos' : os === 'linux' ? 'linux' : 'macos';

    return new Promise((resolve) => {
      // Phase 7: shell wrapping is opt-in via trustedShell config. Without it
      // the caller must pass operands as args[]; metacharacter-bearing command
      // strings are rejected so a malicious tool cannot smuggle `; curl ...`
      // through a single string field.
      const looksLikeShell =
        /[&|;<>]/.test(command) || (command.includes(' ') && args.length === 0);

      if (looksLikeShell && !this.trustedShell) {
        resolve({
          stdout: '',
          stderr:
            `Refusing to wrap shell command "${command}" in sh -c. ` +
            'Pass operands via args[], or enable trustedShell on the provider for explicit host-shell mode.',
          exitCode: 1,
          duration: Date.now() - startTime,
        });
        return;
      }

      logger.info(`Sandbox exec workDir: ${workDir}`);

      let spawnArgs: string[];
      if (looksLikeShell && this.trustedShell) {
        // Trusted-shell mode: wrap in sh -c for shell interpretation.
        // Marketplace eligibility stays disabled at the metadata layer.
        const fullCommand =
          args.length > 0 ? `${command} ${args.join(' ')}` : command;
        spawnArgs = [
          'sandbox',
          sandboxSubcommand,
          '--full-auto',
          '--',
          'sh',
          '-c',
          fullCommand,
        ];
      } else {
        spawnArgs = [
          'sandbox',
          sandboxSubcommand,
          '--full-auto',
          '--',
          command,
          ...args,
        ];
      }

      const proc = spawn(this.codexPath!, spawnArgs, {
        cwd: workDir,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutId = timeout
        ? setTimeout(() => {
            proc.kill('SIGTERM');
            stderr += '\nExecution timed out';
          }, timeout)
        : undefined;

      proc.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          stdout,
          stderr: stderr + '\n' + error.message,
          exitCode: 1,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  async runScript(
    filePath: string,
    workDir: string,
    options?: ScriptOptions,
  ): Promise<SandboxExecResult> {
    const startTime = Date.now();
    const ext = path.extname(filePath).toLowerCase();
    const os = platform();

    if (!this.codexPath) {
      return {
        stdout: '',
        stderr:
          'Codex CLI is not installed. Install with: npm install -g @openai/codex',
        exitCode: 1,
        duration: Date.now() - startTime,
      };
    }

    // Detect runtime
    let runtime: string;
    let runtimeArgs: string[] = [filePath];
    let isPython = true;

    if (ext === '.js' || ext === '.mjs') {
      // Try to use bundled Node.js first, fallback to system node
      const bundledNode = getBundledNodePath();
      runtime = bundledNode || 'node';
      if (bundledNode) {
        logger.info(`Using bundled Node.js: ${bundledNode}`);
      }
      isPython = false;
    } else if (ext === '.ts' || ext === '.mts') {
      runtime = 'npx';
      runtimeArgs = ['tsx', filePath];
      isPython = false;
    } else {
      // Python script - check if Python is available
      const pythonCmd = getPythonCommand();
      if (!pythonCmd) {
        return {
          stdout: '',
          stderr: `Python is not installed on this system.

To run Python scripts, please install Python:
- macOS: brew install python3
- Windows: Download from https://python.org
- Or use Node.js scripts instead (.js files) which work out of the box.`,
          exitCode: 1,
          duration: Date.now() - startTime,
        };
      }
      runtime = pythonCmd;
    }

    // Add script args
    if (options?.args) {
      runtimeArgs.push(...options.args);
    }

    logger.info(`Running script: ${filePath}`);
    logger.info(`Runtime: ${runtime}, Args: ${runtimeArgs.join(' ')}`);

    // Install packages OUTSIDE the sandbox first (codex sandbox blocks shell access)
    if (options?.packages && options.packages.length > 0) {
      logger.info(`Installing packages: ${options.packages.join(', ')}`);

      const unsafe = options.packages.filter((p) => !SAFE_PACKAGE_NAME.test(p));
      if (unsafe.length > 0) {
        const errMsg = `Refusing to install packages with unsafe names: ${unsafe.join(', ')}`;
        logger.error(errMsg);
        return {
          stdout: '',
          stderr: errMsg,
          exitCode: 1,
          duration: Date.now() - startTime,
        };
      }

      const installer = isPython
        ? {
            bin: os === 'win32' ? 'pip' : 'pip3',
            args: ['install', ...options.packages],
          }
        : { bin: 'npm', args: ['install', ...options.packages] };
      logger.info(`Running: ${installer.bin} ${installer.args.join(' ')}`);
      const installResult = spawnSync(installer.bin, installer.args, {
        cwd: workDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 60000,
        shell: false,
      });
      if (installResult.error || installResult.status !== 0) {
        const errMsg =
          installResult.error?.message ??
          installResult.stderr ??
          `${installer.bin} exited with status ${installResult.status}`;
        logger.error(`Failed to install packages: ${errMsg}`);
        return {
          stdout: '',
          stderr: `Failed to install packages: ${errMsg}`,
          exitCode: installResult.status ?? 1,
          duration: Date.now() - startTime,
        };
      }
      logger.info('Packages installed successfully');
    }

    // Use Codex sandbox subcommand (no API needed)
    const sandboxSubcommand =
      os === 'darwin' ? 'macos' : os === 'linux' ? 'linux' : 'macos';

    return new Promise((resolve) => {
      // Use Codex sandbox macos/linux for sandboxed execution (no API needed)
      // Note: codex sandbox blocks localhost connections, so proxy won't work
      // For network tasks that need proxy, use native provider instead
      //
      // Use --full-auto for full disk access (read + write to workDir)
      // This is needed because scripts may need to write output files to the session folder
      logger.info(`Sandbox workDir: ${workDir}`);

      const proc = spawn(
        this.codexPath!,
        [
          'sandbox',
          sandboxSubcommand,
          '--full-auto',
          '--',
          runtime,
          ...runtimeArgs,
        ],
        {
          cwd: workDir,
          env: { ...process.env, ...options?.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = options?.timeout || 120000;
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        stderr += '\nExecution timed out';
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          stdout,
          stderr: stderr + '\n' + error.message,
          exitCode: 1,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  async stop(): Promise<void> {
    // No persistent state to clean up
  }

  async shutdown(): Promise<void> {
    return this.stop();
  }

  getCapabilities(): SandboxCapabilities {
    return {
      supportsVolumeMounts: false,
      supportsNetworking: false, // --full-auto disables network by default
      isolation: 'process', // Uses OS-level sandboxing (Seatbelt on macOS, Landlock on Linux)
      supportedRuntimes: ['node', 'python', 'bun'],
      supportsPooling: false,
      // Codex provides OS-level isolation, but the current adapter wraps shell
      // commands in `sh -c` and runs `pip`/`npm install` outside the sandbox.
      // Until Task 3 closes those escape paths, downgrade enforcement.
      enforcement: 'reduced',
      reducedIsolationReason:
        'Shell wrapping and out-of-sandbox package installation reduce hard isolation guarantees.',
      supportsNetworkPolicy: false,
      supportsReadDeny: true,
      supportsWriteAllowlist: true,
      supportsAuditEvents: false,
      marketplaceEligible: false,
    };
  }

  setVolumes(volumes: VolumeMount[]): void {
    this.volumes = volumes;
  }
}

/**
 * Metadata for Codex CLI sandbox provider
 */
export const CODEX_CLI_METADATA: SandboxProviderMetadata = {
  type: 'codex',
  name: 'Codex Sandbox',
  version: '1.0.0',
  description:
    "Uses OpenAI Codex's sandbox feature for isolated script execution.",
  configSchema: {
    type: 'object',
    properties: {
      codexPath: {
        type: 'string',
        description:
          'Path to the codex executable (auto-detected if not provided)',
      },
    },
  },
  isolation: 'process',
  supportedRuntimes: ['node', 'python', 'bun'],
  supportsVolumeMounts: false,
  supportsNetworking: false,
  supportsPooling: false,
  enforcement: 'reduced',
  reducedIsolationReason:
    'Shell wrapping and out-of-sandbox package installation reduce hard isolation guarantees.',
  supportsNetworkPolicy: false,
  supportsReadDeny: true,
  supportsWriteAllowlist: true,
  supportsAuditEvents: false,
  marketplaceEligible: false,
};

/**
 * Factory function for CodexProvider
 */
export function createCodexProvider(): CodexProvider {
  return new CodexProvider();
}

/**
 * Codex CLI sandbox provider plugin definition
 */
export const codexPlugin: SandboxPlugin = defineSandboxPlugin({
  metadata: CODEX_CLI_METADATA,
  factory: () => createCodexProvider(),
});
