/**
 * How one download runs on this host.
 *
 * The downloader is a fixed, discovered binary with fixed argv. On macOS it
 * runs under `sandbox-exec` with network access limited to the run's proxy and
 * writes limited to the staging folder; on Linux under bubblewrap with no host
 * network, reaching the proxy through a Unix socket bridged by `socat`. A
 * platform with neither route refuses to download instead of falling back to
 * an unsandboxed shell.
 */

import { accessSync, constants, realpathSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { openDownloadProxy } from './proxy';

export interface PreparedDownload {
  command: string;
  prefix: string[];
  /** `--proxy` value; contains the run's proxy credentials. */
  proxy: string;
  /** Byte cap the wrapper enforces on the file the downloader writes. */
  maxFileBytes: number;
  /** Bytes the network delivered to this attempt so far. */
  received(): number;
  close(): void | Promise<void>;
}

export interface DownloadMediaRuntime {
  prepare(
    stage: string,
    signal: AbortSignal,
    limits: { maxFileBytes: number },
  ): Promise<PreparedDownload>;
}

const SYSTEM_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

/**
 * The loopback port `socat` listens on inside the Linux sandbox. The sandbox
 * has its own network namespace, so a fixed port cannot collide with the host;
 * the proxy itself listens on a Unix socket and has no TCP port.
 */
const LINUX_BRIDGE_PORT = 18_080;

/** The fixed command wrapper: cap the file size, then become the downloader. */
function wrapper(limit: number): string {
  // ulimit -f is in 512-byte blocks.
  return `ulimit -f ${Math.ceil(limit / 512)} || exit 1; exec "$@"`;
}

function findExecutable(
  name: string,
  extraDirs: readonly string[] = [],
): string | null {
  const dirs = [...extraDirs, ...SYSTEM_PATH];
  for (const dir of dirs) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

/** The discovered yt-dlp, or a clear error. Never a shell fallback. */
export function resolveYtDlp(): string {
  const found = findExecutable('yt-dlp');
  if (!found) {
    // Discovery searches fixed folders, never the daemon's PATH, so the
    // message names the folders that are actually searched.
    throw new Error(
      `yt-dlp is not installed. Video downloads look for it in ${SYSTEM_PATH.join(', ')}.`,
    );
  }
  return realpathSync(found);
}

function macProfile(input: {
  stage: string;
  proxyPort: number;
  ytdlp: string;
}): string {
  const readRoots = [
    input.stage,
    dirname(input.ytdlp),
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/opt/homebrew',
    '/usr/local',
    '/Library/Apple',
    '/Library/Developer',
    '/private/etc',
    '/dev',
  ];
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    `(allow network-outbound (remote ip "localhost:${input.proxyPort}"))`,
    '(deny file-read-data)',
    `(allow file-read-data ${readRoots
      .map((root) => `(subpath ${JSON.stringify(root)})`)
      .join(' ')})`,
    '(deny file-write*)',
    `(allow file-write* (subpath ${JSON.stringify(input.stage)}) (literal "/dev/null"))`,
  ].join('\n');
}

export const managedMediaRuntime: DownloadMediaRuntime = {
  async prepare(stage, signal, limits) {
    signal.throwIfAborted();
    const ytdlp = resolveYtDlp();
    const script = wrapper(limits.maxFileBytes);

    if (process.platform === 'darwin') {
      const proxy = await openDownloadProxy({ maxBytes: limits.maxFileBytes });
      const profile = macProfile({
        stage,
        proxyPort: proxy.port,
        ytdlp,
      });
      return {
        command: '/usr/bin/sandbox-exec',
        prefix: ['-p', profile, '/bin/sh', '-c', script, 'media', ytdlp],
        proxy: proxy.url,
        maxFileBytes: limits.maxFileBytes,
        received: proxy.received,
        close: proxy.close,
      };
    }

    if (process.platform === 'linux') {
      const bwrap = findExecutable('bwrap', ['/usr/bin', '/bin']);
      const found = findExecutable('socat', [
        '/usr/bin',
        '/bin',
        '/usr/local/bin',
      ]);
      if (!bwrap || !found) {
        throw new Error(
          'Video downloads on Linux need bubblewrap (bwrap) and socat installed.',
        );
      }
      // Run the socat discovery found, not whatever the daemon's PATH names.
      const socat = realpathSync(found);
      const dir = await mkdtemp(join(await realpath(tmpdir()), 'media-proxy-'));
      try {
        const socket = join(dir, 'proxy.sock');
        const proxy = await openDownloadProxy({
          socketPath: socket,
          sandboxPort: LINUX_BRIDGE_PORT,
          maxBytes: limits.maxFileBytes,
        });
        const roBind = ['/usr', '/bin', '/lib', '/lib64', '/etc/ssl'].flatMap(
          (path) => ['--ro-bind-try', path, path],
        );
        return {
          command: bwrap,
          prefix: [
            '--die-with-parent',
            '--unshare-all',
            '--new-session',
            ...roBind,
            '--ro-bind-try',
            ytdlp,
            ytdlp,
            '--ro-bind-try',
            socat,
            socat,
            '--proc',
            '/proc',
            '--dev',
            '/dev',
            '--tmpfs',
            '/tmp',
            '--bind',
            stage,
            stage,
            '--ro-bind',
            socket,
            '/proxy.sock',
            '--chdir',
            '/',
            '/bin/sh',
            '-c',
            // $1 is the discovered socat; the rest is the downloader argv.
            `bridge="$1"; shift; "$bridge" TCP4-LISTEN:${LINUX_BRIDGE_PORT},bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/proxy.sock & ${script}`,
            'media',
            socat,
            ytdlp,
          ],
          proxy: proxy.url,
          maxFileBytes: limits.maxFileBytes,
          received: proxy.received,
          close: async () => {
            proxy.close();
            await rm(dir, { recursive: true, force: true });
          },
        };
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    }

    throw new Error(
      `Video downloads are not available on ${process.platform} yet.`,
    );
  },
};

/**
 * Test seam: run a given binary with no sandbox and no network policy.
 *
 * Only tests use this. It exists so a fake downloader can prove the runner's
 * argv, progress parsing, publication and cancellation without a real network
 * or a platform sandbox.
 */
export function directRuntime(command: string): DownloadMediaRuntime {
  return {
    async prepare(_stage, _signal, limits) {
      return {
        command,
        prefix: [],
        proxy: '',
        maxFileBytes: limits.maxFileBytes,
        received: () => 0,
        close: () => undefined,
      };
    },
  };
}
