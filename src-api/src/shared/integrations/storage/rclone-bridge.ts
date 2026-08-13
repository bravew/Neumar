import { spawn } from 'child_process';

export interface RcloneRunner {
  run(args: string[]): Promise<{ stdout: string; stderr: string }>;
}

export interface RcloneBridgeOptions {
  runner?: RcloneRunner;
  binary?: string;
}

export interface RcloneCopyInput {
  sourcePath: string;
  remote: string;
  destinationPath: string;
}

export class RcloneBridge {
  private readonly runner: RcloneRunner;

  constructor(options: RcloneBridgeOptions = {}) {
    this.runner =
      options.runner ?? new SpawnRcloneRunner(options.binary ?? 'rclone');
  }

  async version(): Promise<{ version: string; ok: boolean }> {
    const result = await this.runner.run(['version', '--json']);
    const parsed = JSON.parse(result.stdout) as { version?: string };
    const version = parsed.version ?? '0.0.0';
    return { version, ok: isAtLeast(version, '1.65.0') };
  }

  async copyFile(input: RcloneCopyInput): Promise<{ providerId: string }> {
    await this.runner.run([
      'copyto',
      input.sourcePath,
      `${input.remote}:${input.destinationPath}`,
      '--progress',
      '--stats=1s',
      '--stats-one-line',
    ]);
    return { providerId: `${input.remote}:${input.destinationPath}` };
  }
}

class SpawnRcloneRunner implements RcloneRunner {
  constructor(private readonly binary: string) {}

  run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
      child.on('error', reject);
      child.on('close', (code) => {
        const out = Buffer.concat(stdout).toString('utf8');
        const err = Buffer.concat(stderr).toString('utf8');
        if (code === 0) resolve({ stdout: out, stderr: err });
        else reject(new Error(`rclone exited ${code}: ${err}`));
      });
    });
  }
}

function isAtLeast(actual: string, minimum: string): boolean {
  const a = actual.split('.').map((part) => Number(part));
  const b = minimum.split('.').map((part) => Number(part));
  for (let i = 0; i < b.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}
