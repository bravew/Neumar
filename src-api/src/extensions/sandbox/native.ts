/**
 * Native Sandbox Provider
 *
 * Executes commands directly on the host system without isolation.
 * This is a fallback provider for trusted local development. It is NEVER
 * marketplace-eligible.
 *
 * Shell semantics (Phase 7 hardening):
 *   - Default `spawn(command, args, { shell: false })` — no shell metachar
 *     interpretation, no SHELL injection vector.
 *   - Opt-in `trustedShell: true` enables shell interpretation via the
 *     configured shell (or `cmd.exe /c` on Windows). The provider's reported
 *     enforcement and marketplace-eligibility stay 'none'/false in either mode.
 *
 * WARNING: Even with trustedShell disabled, no security isolation is provided.
 * This is solely a defense against accidental command injection.
 */

import { spawn } from 'child_process';
import * as path from 'path';

import { defineSandboxPlugin, NATIVE_METADATA } from '@/core/sandbox/plugin';
import type { SandboxPlugin } from '@/core/sandbox/plugin';
import type {
  ISandboxProvider,
  NativeProviderConfig,
  SandboxCapabilities,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxProviderType,
  ScriptOptions,
  VolumeMount,
} from '@/core/sandbox/types';

import { getAppDir } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('NativeProvider');

/**
 * Match anything that the host shell would interpret. We intentionally include
 * quote and parenthesis chars so a caller cannot smuggle word splitting via
 * `args` even when shell:false would already block operator chains.
 */
const SHELL_METACHARS = /[\s&|;<>$`(){}[\]\\"'*?!#~]/;

/**
 * On Windows, environment variable keys are case-insensitive but Node's
 * `process.env` exposes them as a normal object. Two records can disagree on
 * casing (`PATH` vs `Path`), and child processes resolve binaries against
 * whichever the OS returns first — usually undefined. Collapse to a single
 * canonical key per case-insensitive group, with the merge order's last value
 * winning.
 */
function normalizeWindowsEnv(
  env: Record<string, string>,
): Record<string, string> {
  if (process.platform !== 'win32') return env;
  const seen = new Map<string, string>(); // lowercased key → canonical key
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const lower = key.toLowerCase();
    const existingCanonical = seen.get(lower);
    if (existingCanonical !== undefined) {
      // Drop the earlier-cased entry, keep the later one's value under its key.
      delete result[existingCanonical];
    }
    seen.set(lower, key);
    result[key] = value;
  }
  return result;
}

export class NativeProvider implements ISandboxProvider {
  readonly type: SandboxProviderType = 'native';
  readonly name = 'Native (No Isolation)';
  readonly version = '1.0.0';

  private config: NativeProviderConfig['config'] = {
    allowedDirectories: [],
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    trustedShell: false,
    defaultTimeout: 120000,
  };

  private volumes: VolumeMount[] = [];

  async isAvailable(): Promise<boolean> {
    // Native execution is always available
    return true;
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    if (this.config.trustedShell) {
      logger.warn(
        'Initialized in TRUSTED-SHELL mode — host shell interpretation is enabled. Never use for marketplace or untrusted code.',
      );
    } else {
      logger.info('Initialized (no isolation, shell:false)');
    }
  }

  /**
   * Resolve the spawn shell option. Returns:
   *   - false (default): no shell, no metachar interpretation.
   *   - string: explicit shell binary path when trustedShell is enabled and
   *     a shell is configured.
   *   - true: only on Windows trusted-shell when no specific shell is set,
   *     letting Node resolve %ComSpec% (cmd.exe) for .bat/.cmd handling.
   */
  private resolveShell(): false | string | true {
    if (!this.config.trustedShell) return false;
    const configured = this.config.shell;
    if (configured && configured.length > 0) return configured;
    return process.platform === 'win32' ? true : '/bin/sh';
  }

  async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
    const startTime = Date.now();
    const { command, args = [], cwd, env, timeout } = options;

    const workDir = cwd || getAppDir();
    const execTimeout = timeout || this.config.defaultTimeout || 120000;
    const shell = this.resolveShell();

    if (shell === false && SHELL_METACHARS.test(command)) {
      return {
        stdout: '',
        stderr:
          `Refusing to execute "${command}": shell metacharacters detected. ` +
          'Pass operands via args[], or enable trustedShell for explicit host-shell mode.',
        exitCode: 1,
        duration: Date.now() - startTime,
      };
    }

    const mergedEnv = normalizeWindowsEnv({ ...process.env, ...env } as Record<
      string,
      string
    >);

    return new Promise((resolve) => {
      logger.info(
        `Executing: ${command} ${args.join(' ')} (cwd: ${workDir}, shell: ${shell === false ? 'none' : 'trusted'})`,
      );

      const proc = spawn(command, args, {
        cwd: workDir,
        env: mergedEnv,
        shell,
        timeout: execTimeout,
      });

      let stdout = '';
      let stderr = '';

      // Drain stdout and stderr concurrently to prevent OS pipe buffer
      // deadlock when one stream fills before the other is consumed.
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (error) => {
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
    const ext = path.extname(filePath).toLowerCase();
    let runtime = 'node';
    let runtimeArgs: string[] = [];

    switch (ext) {
      case '.py':
        runtime = 'python3';
        break;
      case '.ts':
      case '.mts':
        runtime = 'npx';
        runtimeArgs = ['tsx'];
        break;
      case '.js':
      case '.mjs':
        runtime = 'node';
        break;
      case '.sh':
        runtime = 'bash';
        break;
      default:
        runtime = 'node';
    }

    // Install packages if specified
    if (options?.packages && options.packages.length > 0 && ext !== '.py') {
      logger.info(`Installing packages: ${options.packages.join(', ')}`);
      await this.exec({
        command: 'npm',
        args: ['install', '--no-save', ...options.packages],
        cwd: workDir,
        env: options.env,
      });
    }

    return this.exec({
      command: runtime,
      args: [...runtimeArgs, filePath, ...(options?.args || [])],
      cwd: workDir,
      env: options?.env,
      timeout: options?.timeout,
    });
  }

  async stop(): Promise<void> {
    logger.info('Stopped');
  }

  async shutdown(): Promise<void> {
    return this.stop();
  }

  getCapabilities(): SandboxCapabilities {
    const trustedShell = !!this.config.trustedShell;
    return {
      supportsVolumeMounts: false, // N/A - runs on host directly
      supportsNetworking: true,
      isolation: 'none',
      supportedRuntimes: ['node', 'python', 'bun', 'bash'],
      supportsPooling: false,
      enforcement: 'none',
      supportsNetworkPolicy: false,
      supportsReadDeny: false,
      supportsWriteAllowlist: false,
      supportsAuditEvents: false,
      marketplaceEligible: false,
      reducedIsolationReason: trustedShell
        ? 'trustedShell mode is enabled — host shell interpretation is active.'
        : undefined,
    };
  }

  setVolumes(volumes: VolumeMount[]): void {
    // Native provider doesn't need volume mounts since it runs on host
    this.volumes = volumes;
  }
}

/**
 * Factory function for NativeProvider
 */
export function createNativeProvider(config?: {
  config?: NativeProviderConfig['config'];
}): NativeProvider {
  const provider = new NativeProvider();
  if (config?.config) {
    provider.init(config.config);
  }
  return provider;
}

/**
 * Native provider plugin definition
 */
export const nativePlugin: SandboxPlugin = defineSandboxPlugin({
  metadata: NATIVE_METADATA,
  factory: (config) =>
    createNativeProvider(config ? { config: config.config } : undefined),
});
