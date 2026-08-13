import { exec } from 'node:child_process';
import { accessSync, constants as fsConstants, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import { Hono } from 'hono';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Doctor');
const execAsync = promisify(exec);

// ── Types ────────────────────────────────────────────────────────────────────

interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

interface DoctorReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: DoctorCheck[];
}

// ── Timeout wrapper ──────────────────────────────────────────────────────────

const CHECK_TIMEOUT = 5_000;

async function withTimeout<T>(fn: () => Promise<T>, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const result = await Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`Check '${name}' timed out after ${CHECK_TIMEOUT}ms`),
          ),
        CHECK_TIMEOUT,
      );
    }),
  ]);
  clearTimeout(timer!);
  return result;
}

// ── Individual checks ────────────────────────────────────────────────────────

async function checkNodeVersion(): Promise<DoctorCheck> {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  if (major >= 20) {
    return { name: 'Node.js version', status: 'pass', message: `${version}` };
  }
  return {
    name: 'Node.js version',
    status: major >= 18 ? 'warn' : 'fail',
    message: `${version} (>= 20.0.0 recommended)`,
    fix: 'Install Node.js 20+ from https://nodejs.org or via nvm: nvm install 20',
  };
}

async function checkGit(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execAsync('git --version');
    return {
      name: 'Git',
      status: 'pass',
      message: stdout.trim(),
    };
  } catch {
    return {
      name: 'Git',
      status: 'fail',
      message: 'Git not found',
      fix: 'Install Git: https://git-scm.com/downloads',
    };
  }
}

async function checkApiKey(): Promise<DoctorCheck> {
  const key = getSetting('anthropicApiKey') ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      name: 'API key',
      status: 'fail',
      message: 'No Anthropic API key configured',
      fix: 'Set your API key in Settings > Account or set the ANTHROPIC_API_KEY environment variable',
    };
  }
  if (key.startsWith('sk-ant-')) {
    return {
      name: 'API key',
      status: 'pass',
      message: 'Configured (sk-ant-...)',
    };
  }
  return {
    name: 'API key',
    status: 'warn',
    message: 'API key set but does not start with sk-ant-',
  };
}

async function checkWorkDir(): Promise<DoctorCheck> {
  const workDir = getSetting('workDir');
  if (!workDir) {
    return {
      name: 'Workspace directory',
      status: 'warn',
      message: 'No workspace directory configured',
      fix: 'Set a workspace directory in Settings > Workspace',
    };
  }
  try {
    accessSync(workDir, fsConstants.R_OK | fsConstants.W_OK);
    return {
      name: 'Workspace directory',
      status: 'pass',
      message: workDir,
    };
  } catch {
    return {
      name: 'Workspace directory',
      status: 'fail',
      message: `${workDir} is not readable/writable`,
      fix: `Check permissions: chmod u+rw "${workDir}"`,
    };
  }
}

async function checkDatabase(): Promise<DoctorCheck> {
  try {
    // Import dynamically to avoid circular dependency issues
    const { getDatabase } = await import('@/shared/db');
    const db = getDatabase();
    const result = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: string }
      | undefined;
    const status = result?.integrity_check ?? 'unknown';
    if (status === 'ok') {
      return { name: 'Database integrity', status: 'pass', message: 'OK' };
    }
    return {
      name: 'Database integrity',
      status: 'fail',
      message: `PRAGMA integrity_check: ${status}`,
    };
  } catch (err) {
    return {
      name: 'Database integrity',
      status: 'fail',
      message: `Database check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkDiskSpace(): Promise<DoctorCheck> {
  const workDir = getSetting('workDir');
  const dir = workDir ?? homedir();
  try {
    const stats = statfsSync(dir);
    const freeBytes = stats.bfree * stats.bsize;
    const freeMB = Math.round(freeBytes / (1024 * 1024));
    if (freeMB > 100) {
      return {
        name: 'Disk space',
        status: 'pass',
        message: `${freeMB} MB free`,
      };
    }
    return {
      name: 'Disk space',
      status: freeMB > 50 ? 'warn' : 'fail',
      message: `Only ${freeMB} MB free`,
      fix: 'Free up disk space in the workspace directory',
    };
  } catch {
    return {
      name: 'Disk space',
      status: 'warn',
      message: 'Could not check disk space',
    };
  }
}

async function checkClaudeBinary(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execAsync(
      'claude --version 2>/dev/null || echo "not found"',
    );
    const trimmed = stdout.trim();
    if (trimmed === 'not found' || !trimmed) {
      return {
        name: 'Claude Code CLI',
        status: 'warn',
        message: 'Claude Code CLI not found in PATH',
        fix: 'Install Claude Code: npm install -g @anthropic-ai/claude-code',
      };
    }
    return {
      name: 'Claude Code CLI',
      status: 'pass',
      message: trimmed,
    };
  } catch {
    return {
      name: 'Claude Code CLI',
      status: 'warn',
      message: 'Could not check Claude Code CLI',
      fix: 'Install Claude Code: npm install -g @anthropic-ai/claude-code',
    };
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

const doctorRoutes = new Hono();

doctorRoutes.get('/', async (c) => {
  logger.info('Running environment diagnostics...');

  const checks = await Promise.all([
    withTimeout(checkNodeVersion, 'Node.js version').catch((err) => ({
      name: 'Node.js version',
      status: 'fail' as const,
      message: err instanceof Error ? err.message : String(err),
    })),
    withTimeout(checkGit, 'Git').catch((err) => ({
      name: 'Git',
      status: 'fail' as const,
      message: err instanceof Error ? err.message : String(err),
    })),
    withTimeout(checkApiKey, 'API key').catch((err) => ({
      name: 'API key',
      status: 'fail' as const,
      message: err instanceof Error ? err.message : String(err),
    })),
    withTimeout(checkWorkDir, 'Workspace directory').catch((err) => ({
      name: 'Workspace directory',
      status: 'fail' as const,
      message: err instanceof Error ? err.message : String(err),
    })),
    withTimeout(checkDatabase, 'Database').catch((err) => ({
      name: 'Database integrity',
      status: 'fail' as const,
      message: err instanceof Error ? err.message : String(err),
    })),
    withTimeout(checkDiskSpace, 'Disk space').catch((err) => ({
      name: 'Disk space',
      status: 'fail' as const,
      message: err instanceof Error ? err.message : String(err),
    })),
    withTimeout(checkClaudeBinary, 'Claude Code CLI').catch((err) => ({
      name: 'Claude Code CLI',
      status: 'fail' as const,
      message: err instanceof Error ? err.message : String(err),
    })),
  ]);

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');
  const overall: DoctorReport['overall'] = hasFail
    ? 'unhealthy'
    : hasWarn
      ? 'degraded'
      : 'healthy';

  const report: DoctorReport = { overall, checks };
  logger.info(`Diagnostics complete: ${overall} (${checks.length} checks)`);

  return c.json(report);
});

export { doctorRoutes };
