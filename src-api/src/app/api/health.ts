import { exec, execFile } from 'child_process';
import { existsSync } from 'fs';
import { arch, platform } from 'os';
import { dirname, join } from 'path';
import { promisify } from 'util';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { getPlanManager } from '@/core/plan-manager';
import { getSessionManager } from '@/core/session-manager';

import {
  detectAgents,
  getAgentDef,
  getExtendedPath,
  resolveOnPath,
} from '@/shared/agent-runtimes';
import { getAssetRegistry } from '@/shared/assets';
import { getMemoryMonitor } from '@/shared/monitoring/memory-monitor';
import { detectBinaries } from '@/shared/services/ffmpeg/executor';
import { getMemoryBudgetSupervisor } from '@/shared/services/memory-budget';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Health');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Detect platform
const isWindows = process.platform === 'win32';

const healthRoutes = new Hono();

healthRoutes.get('/', (c) => {
  const memoryUsage = process.memoryUsage();
  const memoryMonitor = getMemoryMonitor();
  const memoryBudget = getMemoryBudgetSupervisor().getStatus();
  const sessionManager = getSessionManager();
  const planManager = getPlanManager();

  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      external: Math.round(memoryUsage.external / 1024 / 1024), // MB
      arrayBuffers: Math.round(memoryUsage.arrayBuffers / 1024 / 1024), // MB
      unit: 'MB',
      budget: memoryBudget,
    },
    resources: {
      sessions: sessionManager.getMetrics(),
      plans: planManager.getMetrics(),
      monitoring: memoryMonitor.getMetrics(),
      memoryBudget,
      assetStorage: assetStorageHealthSummary(),
    },
  });
});

function assetStorageHealthSummary() {
  try {
    const stats = getAssetRegistry().storageStats();
    return {
      managedBytes: stats.managedBytes,
      cacheBytes: stats.cacheBytes,
      materializedBytes: stats.materializedBytes,
      proxyBytes: stats.proxyBytes,
      previewArtifactBytes: stats.previewArtifactBytes,
      materializedBytesByScope: stats.materializedBytesByScope,
    };
  } catch (error) {
    logger.warn('Failed to collect asset storage health metrics:', error);
    return null;
  }
}

// ============================================================================
// Dependency Types
// ============================================================================

interface DependencyInfo {
  id: string;
  name: string;
  description: string;
  required: boolean;
  binaryName: string;
  versionArgs?: string[];
  installSpecs: InstallSpecs;
  installUrl: string;
}

interface DependencyStatus {
  id: string;
  name: string;
  description: string;
  required: boolean;
  installed: boolean;
  version?: string;
  installUrl: string;
}

type InstallMethod = 'npm' | 'brew' | 'auto';

type PackageInstallSpec =
  | {
      manager: 'npm';
      packageName: string;
      global: true;
    }
  | {
      manager: 'brew';
      packageName: string;
      packageKind: 'formula';
    };

type NpmInstallSpec = Extract<PackageInstallSpec, { manager: 'npm' }>;
type BrewInstallSpec = Extract<PackageInstallSpec, { manager: 'brew' }>;

interface ManualInstallSpec {
  manager: 'manual';
  command: string;
}

interface InstallSpecs {
  npm?: NpmInstallSpec;
  brew?: BrewInstallSpec;
  manual?: ManualInstallSpec;
}

// ============================================================================
// Supported Dependencies
// ============================================================================

const DEPENDENCIES: DependencyInfo[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Agent Runtime for task processing',
    required: true,
    binaryName: 'claude',
    versionArgs: ['--version'],
    installSpecs: {
      npm: {
        manager: 'npm',
        packageName: '@anthropic-ai/claude-code',
        global: true,
      },
      manual: {
        manager: 'manual',
        command: 'Visit https://docs.anthropic.com/claude-code/install',
      },
    },
    installUrl:
      'https://docs.anthropic.com/en/docs/claude-code/getting-started',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    description: 'Sandbox for script execution',
    required: false,
    binaryName: 'codex',
    versionArgs: ['--version'],
    installSpecs: {
      npm: {
        manager: 'npm',
        packageName: '@openai/codex',
        global: true,
      },
      manual: {
        manager: 'manual',
        command: 'Visit https://github.com/openai/codex-cli',
      },
    },
    installUrl: 'https://github.com/openai/codex-cli',
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    description: 'Video rendering, probing, transcoding, and timeline export',
    required: false,
    binaryName: 'ffmpeg',
    versionArgs: ['-version'],
    installSpecs: {
      brew: {
        manager: 'brew',
        packageName: 'ffmpeg',
        packageKind: 'formula',
      },
      manual: {
        manager: 'manual',
        command: 'Visit https://ffmpeg.org/download.html',
      },
    },
    installUrl: 'https://ffmpeg.org/download.html',
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

const INSTALL_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_INSTALL_OUTPUT_BYTES = 10 * 1024 * 1024;
const SAFE_BINARY_NAME_RE = /^[A-Za-z0-9._+-]+$/;
const SAFE_NPM_PACKAGE_RE =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SAFE_BREW_FORMULA_RE = /^[a-z0-9][a-z0-9@._+-]*$/;

interface InstallCommandSpec {
  executable: string;
  args: string[];
  displayCommand: string;
  env: NodeJS.ProcessEnv;
}

interface InstallRunResult {
  success: boolean;
  output: string;
  error?: string;
  failureKind?: 'package-manager-unavailable' | 'install-failed';
}

function installCommandsForDependency(dep: DependencyInfo): {
  npm?: string;
  brew?: string;
  manual?: string;
} {
  return {
    npm: dep.installSpecs.npm
      ? displayInstallCommand(dep.installSpecs.npm)
      : undefined,
    brew: dep.installSpecs.brew
      ? displayInstallCommand(dep.installSpecs.brew)
      : undefined,
    manual: dep.installSpecs.manual?.command,
  };
}

function displayInstallCommand(spec: PackageInstallSpec): string {
  if (spec.manager === 'npm') {
    return ['npm', 'install', ...(spec.global ? ['-g'] : []), spec.packageName]
      .filter(Boolean)
      .join(' ');
  }
  return ['brew', 'install', '--formula', spec.packageName].join(' ');
}

function selectInstallSpec(
  dep: DependencyInfo,
  method: InstallMethod,
): PackageInstallSpec | null {
  if (method === 'npm') return dep.installSpecs.npm ?? null;
  if (method === 'brew') return dep.installSpecs.brew ?? null;
  return dep.installSpecs.npm ?? dep.installSpecs.brew ?? null;
}

function assertSafeBinaryName(binaryName: string): void {
  if (!SAFE_BINARY_NAME_RE.test(binaryName)) {
    throw new Error(`Unsafe binary name: ${binaryName}`);
  }
}

function validateInstallSpec(spec: PackageInstallSpec): void {
  if (spec.manager === 'npm') {
    if (!SAFE_NPM_PACKAGE_RE.test(spec.packageName)) {
      throw new Error(`Unsafe npm package name: ${spec.packageName}`);
    }
    return;
  }

  if (spec.packageKind !== 'formula') {
    throw new Error(`Unsupported Homebrew package kind: ${spec.packageKind}`);
  }
  if (!SAFE_BREW_FORMULA_RE.test(spec.packageName)) {
    throw new Error(`Unsafe Homebrew formula name: ${spec.packageName}`);
  }
}

function resolvePackageManager(manager: PackageInstallSpec['manager']): string {
  const resolved = resolveOnPath(manager);
  if (!resolved) {
    throw new Error(
      manager === 'brew'
        ? 'Homebrew is not installed or is not visible to the app.'
        : 'npm is not installed or is not visible to the app.',
    );
  }
  return resolved.path;
}

function buildInstallCommand(spec: PackageInstallSpec): InstallCommandSpec {
  validateInstallSpec(spec);

  if (spec.manager === 'npm') {
    return {
      executable: resolvePackageManager('npm'),
      args: ['install', ...(spec.global ? ['-g'] : []), spec.packageName],
      displayCommand: displayInstallCommand(spec),
      env: {
        ...process.env,
        PATH: getExtendedPath(),
      },
    };
  }

  return {
    executable: resolvePackageManager('brew'),
    args: ['install', '--formula', spec.packageName],
    displayCommand: displayInstallCommand(spec),
    env: {
      ...process.env,
      PATH: getExtendedPath(),
      HOMEBREW_ALLOWED_TAPS:
        process.env.HOMEBREW_ALLOWED_TAPS || 'homebrew/core',
    },
  };
}

/**
 * Get the target triple for the current platform
 */
function getTargetTriple(): string {
  const os = platform();
  const cpuArch = arch();

  if (os === 'darwin') {
    return cpuArch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  } else if (os === 'linux') {
    return cpuArch === 'arm64'
      ? 'aarch64-unknown-linux-gnu'
      : 'x86_64-unknown-linux-gnu';
  } else if (os === 'win32') {
    return 'x86_64-pc-windows-msvc';
  }

  return 'unknown';
}

/**
 * Check if bundled sidecar Claude Code exists
 * The bundle structure is:
 * - claude-{target} or claude (launcher script)
 * - cli-bundle/
 *   - node (Node.js binary)
 *   - node_modules/@anthropic-ai/claude-code/ (Claude Code package)
 */
function checkSidecarClaudeCode(): boolean {
  const os = platform();
  const targetTriple = getTargetTriple();
  const claudeName =
    os === 'win32' ? `claude-${targetTriple}.exe` : `claude-${targetTriple}`;

  // Get the directory where this process (API binary) is running from
  const execDir = dirname(process.execPath);

  // Possible locations for the bundled Claude Code launcher
  const possibleLauncherPaths = [
    join(execDir, claudeName),
    join(execDir, 'claude'),
  ];

  // For macOS .app bundles, also check Resources directory
  if (os === 'darwin') {
    const resourcesDir = join(execDir, '..', 'Resources');
    possibleLauncherPaths.push(join(resourcesDir, claudeName));
    possibleLauncherPaths.push(join(resourcesDir, 'claude'));
  }

  // For pkg bundled apps
  // @ts-expect-error - pkg specific property
  if (process.pkg) {
    const pkgDir = dirname(process.argv[0]!);
    possibleLauncherPaths.push(join(pkgDir, claudeName));
    possibleLauncherPaths.push(join(pkgDir, 'claude'));
  }

  // Check each possible launcher path
  for (const launcherPath of possibleLauncherPaths) {
    if (!existsSync(launcherPath)) continue;

    // Get the directory containing the launcher
    const launcherDir = dirname(launcherPath);

    // Check if cli-bundle directory exists alongside the launcher
    const bundleDir = join(launcherDir, 'cli-bundle');
    const claudeCliPath = join(
      bundleDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli.js',
    );
    const nodeBinPath = join(bundleDir, os === 'win32' ? 'node.exe' : 'node');

    if (
      existsSync(bundleDir) &&
      existsSync(claudeCliPath) &&
      existsSync(nodeBinPath)
    ) {
      logger.info(`Found bundled Claude Code at: ${launcherPath}`);
      return true;
    }

    // If launcher exists without bundle dir, it might be a standalone binary
    if (existsSync(launcherPath)) {
      logger.info(`Found Claude Code launcher at: ${launcherPath}`);
      return true;
    }
  }

  // Also try direct check for cli-bundle in common locations
  const bundleLocations = [
    join(execDir, 'cli-bundle'),
    join(execDir, '..', 'Resources', 'cli-bundle'),
    join(execDir, '..', 'Resources', '_up_', 'src-api', 'dist', 'cli-bundle'),
    // Windows: Tauri places resources relative to exe with preserved path structure
    join(execDir, '_up_', 'src-api', 'dist', 'cli-bundle'),
  ];

  for (const bundleDir of bundleLocations) {
    if (!existsSync(bundleDir)) continue;

    const claudeCliPath = join(
      bundleDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli.js',
    );
    const nodeBinPath = join(bundleDir, os === 'win32' ? 'node.exe' : 'node');

    if (existsSync(claudeCliPath) && existsSync(nodeBinPath)) {
      logger.info(`Found bundled Claude Code at: ${bundleDir}`);
      return true;
    }
  }

  return false;
}

// Check if WSL is available on Windows
async function checkWslAvailable(): Promise<boolean> {
  if (!isWindows) return false;
  try {
    await execAsync('wsl --status', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Check command in WSL
async function checkCommandInWsl(command: string): Promise<boolean> {
  assertSafeBinaryName(command);
  try {
    await execFileAsync('wsl', ['-e', 'which', command], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function checkNativeBinary(binaryName: string): boolean {
  assertSafeBinaryName(binaryName);
  return resolveOnPath(binaryName) !== null;
}

// Check dependency with fallback to WSL on Windows and sidecar
async function checkDependency(dep: DependencyInfo): Promise<{
  installed: boolean;
  location: 'native' | 'wsl' | 'sidecar' | null;
  version?: string;
}> {
  if (dep.id === 'ffmpeg') {
    const binaries = detectBinaries();
    return binaries
      ? { installed: true, location: 'native', version: binaries.version }
      : { installed: false, location: null };
  }

  const binaryName = dep.binaryName;

  // First try native check
  const nativeInstalled = checkNativeBinary(binaryName);
  if (nativeInstalled) {
    const version = await getVersion(dep);
    return { installed: true, location: 'native', version };
  }

  // On Windows, also check WSL
  if (isWindows) {
    const wslAvailable = await checkWslAvailable();
    if (wslAvailable) {
      const wslInstalled = await checkCommandInWsl(binaryName);
      if (wslInstalled) {
        const version = await getVersion(dep, 'wsl');
        return { installed: true, location: 'wsl', version };
      }
    }
  }

  // Check for bundled sidecar (for claude-code specifically)
  if (binaryName === 'claude') {
    const sidecarInstalled = checkSidecarClaudeCode();
    if (sidecarInstalled) {
      return { installed: true, location: 'sidecar' };
    }
  }

  return { installed: false, location: null };
}

async function getVersion(
  dep: DependencyInfo,
  location: 'native' | 'wsl' = 'native',
): Promise<string | undefined> {
  if (!dep.versionArgs) return undefined;
  assertSafeBinaryName(dep.binaryName);

  try {
    if (location === 'wsl') {
      const { stdout } = await execFileAsync(
        'wsl',
        ['-e', dep.binaryName, ...dep.versionArgs],
        { timeout: 10000 },
      );
      return stdout.trim();
    }

    const resolved = resolveOnPath(dep.binaryName);
    if (!resolved) return undefined;
    const { stdout } = await execFileAsync(resolved.path, dep.versionArgs, {
      env: {
        ...process.env,
        PATH: getExtendedPath(),
      },
      timeout: 10000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function runInstallSpec(
  spec: PackageInstallSpec,
): Promise<InstallRunResult> {
  let command: InstallCommandSpec;
  try {
    command = buildInstallCommand(spec);
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : 'Invalid install command',
      failureKind: 'package-manager-unavailable',
    };
  }

  try {
    logger.info(`Running dependency install: ${command.displayCommand}`);
    const { stdout, stderr } = await execFileAsync(
      command.executable,
      command.args,
      {
        timeout: INSTALL_TIMEOUT_MS,
        env: command.env,
        windowsHide: true,
        maxBuffer: MAX_INSTALL_OUTPUT_BYTES,
      },
    );
    return { success: true, output: stdout + stderr };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: err.stdout || '',
      error: err.stderr || err.message || 'Unknown error',
      failureKind: 'install-failed',
    };
  }
}

// ============================================================================
// Endpoints
// ============================================================================

// Map a /health/dependencies entry id (e.g. 'claude-code') to the
// agent-runtimes registry id (e.g. 'claude'). Some entries don't have a
// registry counterpart (none currently, but kept open) and fall back to
// the legacy probe.
const DEP_TO_REGISTRY: Record<string, string> = {
  'claude-code': 'claude',
  codex: 'codex',
};

/**
 * Check all dependencies status
 * GET /health/dependencies
 *
 * Derives Claude/Codex rows from the agent-runtimes registry while
 * preserving the existing response shape (claudeCode, codex booleans;
 * dependencies[] with id, name, installed, version). The legacy WSL +
 * bundled-sidecar fallbacks are still consulted for `claude` so first-run
 * setup keeps working in Tauri.
 */
healthRoutes.get('/dependencies', async (c) => {
  const statuses: DependencyStatus[] = [];
  const simpleStatus: Record<string, boolean> = {};

  // Pull the registry once; reuse for every row.
  let registryStatuses: Awaited<ReturnType<typeof detectAgents>> = [];
  try {
    registryStatuses = await detectAgents();
  } catch (err) {
    logger.warn(
      `agent-runtimes detection failed, falling back to legacy probes: ${(err as Error).message}`,
    );
  }
  const registryById = new Map(registryStatuses.map((r) => [r.id, r]));

  for (const dep of DEPENDENCIES) {
    const registryId = DEP_TO_REGISTRY[dep.id];
    const registryRow = registryId ? registryById.get(registryId) : undefined;

    let installed = false;
    let location: 'native' | 'wsl' | 'sidecar' | null = null;
    let version: string | undefined;

    if (registryRow && registryRow.available) {
      installed = true;
      location = 'native';
      version = registryRow.version;
    } else {
      const probed = await checkDependency(dep);
      installed = probed.installed;
      location = probed.location;
      version = probed.version;
    }

    let versionString: string | undefined;
    if (version) {
      versionString = location === 'wsl' ? `${version} (WSL)` : version;
    } else if (location === 'sidecar') {
      versionString = '(Bundled)';
    }

    statuses.push({
      id: dep.id,
      name: dep.name,
      description: dep.description,
      required: dep.required,
      installed,
      version: versionString,
      installUrl: dep.installUrl,
    });

    const key = dep.id === 'claude-code' ? 'claudeCode' : dep.id;
    simpleStatus[key] = installed;
  }

  const allRequiredInstalled = statuses
    .filter((s) => s.required)
    .every((s) => s.installed);

  return c.json({
    success: true,
    allRequiredInstalled,
    ...simpleStatus,
    dependencies: statuses,
  });
});

/**
 * Get install commands for a dependency
 * GET /health/dependencies/:id/install-commands
 */
healthRoutes.get('/dependencies/:id/install-commands', (c) => {
  const { id } = c.req.param();
  const dep = DEPENDENCIES.find((d) => d.id === id);

  if (!dep) {
    return c.json({ success: false, error: 'Dependency not found' }, 404);
  }

  return c.json({
    success: true,
    id: dep.id,
    name: dep.name,
    commands: installCommandsForDependency(dep),
    installUrl: dep.installUrl,
  });
});

/**
 * Install a dependency
 * POST /health/dependencies/:id/install
 * Body: { method: 'npm' | 'brew' | 'auto', confirmed: true }
 */
const InstallBodySchema = z.object({
  method: z.enum(['npm', 'brew', 'auto']).optional(),
  confirmed: z.literal(true),
});

healthRoutes.post(
  '/dependencies/:id/install',
  zValidator('json', InstallBodySchema),
  async (c) => {
    const { id } = c.req.param();
    const body = c.req.valid('json');
    const method = body.method || 'auto';

    const dep = DEPENDENCIES.find((d) => d.id === id);

    if (!dep) {
      return c.json({ success: false, error: 'Dependency not found' }, 404);
    }

    const installSpec = selectInstallSpec(dep, method);

    if (!installSpec) {
      return c.json(
        {
          success: false,
          error: `No ${method} install command available for ${dep.name}`,
          installUrl: dep.installUrl,
        },
        400,
      );
    }

    logger.info(
      `Installing ${dep.name} with ${installSpec.manager}: ${installSpec.packageName}`,
    );

    const result = await runInstallSpec(installSpec);

    if (result.success) {
      // Verify installation
      const checked = await checkDependency(dep);
      const installed = checked.installed;
      const version = checked.version;

      return c.json({
        success: installed,
        installed,
        version,
        output: result.output,
        message: installed
          ? `${dep.name} installed successfully`
          : `Installation completed but ${dep.name} not found in PATH`,
      });
    } else {
      const status =
        result.failureKind === 'package-manager-unavailable' ? 409 : 500;
      return c.json(
        {
          success: false,
          error: result.error,
          output: result.output,
          installUrl: dep.installUrl,
          message:
            result.error ||
            `Failed to install ${dep.name}. Please install manually.`,
        },
        status,
      );
    }
  },
);

/**
 * Check a single dependency
 * GET /health/dependencies/:id
 */
healthRoutes.get('/dependencies/:id', async (c) => {
  const { id } = c.req.param();
  const dep = DEPENDENCIES.find((d) => d.id === id);

  if (!dep) {
    return c.json({ success: false, error: 'Dependency not found' }, 404);
  }

  let installed = false;
  let location: 'native' | 'wsl' | 'sidecar' | null = null;
  let version: string | undefined;

  const registryId = DEP_TO_REGISTRY[dep.id];
  const registryDef = registryId ? getAgentDef(registryId) : null;
  if (registryDef) {
    try {
      const list = await detectAgents();
      const row = list.find((r) => r.id === registryId);
      if (row && row.available) {
        installed = true;
        location = 'native';
        version = row.version;
      }
    } catch {
      // fall through to legacy probe
    }
  }

  if (!installed) {
    const probed = await checkDependency(dep);
    installed = probed.installed;
    location = probed.location;
    version = probed.version;
  }

  // Build version string with location indicator
  let versionString: string | undefined;
  if (version) {
    versionString = location === 'wsl' ? `${version} (WSL)` : version;
  } else if (location === 'sidecar') {
    versionString = '(Bundled)';
  }

  return c.json({
    success: true,
    id: dep.id,
    name: dep.name,
    description: dep.description,
    required: dep.required,
    installed,
    version: versionString,
    location: location,
    installUrl: dep.installUrl,
  });
});

export { healthRoutes };
