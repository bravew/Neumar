import { spawn } from 'node:child_process';

export interface StreamingCommandInput {
  bin: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onLine?: (line: string, source: 'stdout' | 'stderr') => void;
}

export interface StreamingCommandResult {
  stdout: string;
  stderr: string;
}

export class StreamingCommandError extends Error {
  constructor(
    public readonly code: 'not-found' | 'aborted' | 'timeout' | 'failed',
    message: string,
    public readonly exitCode?: number,
    public readonly stdout = '',
    public readonly stderr = '',
  ) {
    super(message);
    this.name = 'StreamingCommandError';
  }
}

export function runStreamingCommand({
  bin,
  args,
  cwd,
  env = process.env,
  signal,
  timeoutMs = 600_000,
  onLine,
}: StreamingCommandInput): Promise<StreamingCommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new StreamingCommandError('aborted', `${bin} was aborted`));
      return;
    }
    const child = spawn(bin, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(
        new StreamingCommandError(
          'timeout',
          `${bin} timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    const abort = () => {
      child.kill('SIGTERM');
      finish(new StreamingCommandError('aborted', `${bin} was aborted`));
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };

    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      finish(
        new StreamingCommandError(
          code === 'ENOENT' ? 'not-found' : 'failed',
          `${bin} could not start: ${error.message}`,
        ),
      );
    });
    child.on('close', (code, closeSignal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new StreamingCommandError(
          'failed',
          `${bin} exited with ${closeSignal ? `signal ${closeSignal}` : `code ${code ?? 'unknown'}`}`,
          code ?? undefined,
          stdout,
          stderr,
        ),
      );
    });
    stdout = collectLines(child.stdout, 'stdout', onLine, (value) => {
      stdout += value;
    });
    stderr = collectLines(child.stderr, 'stderr', onLine, (value) => {
      stderr += value;
    });
  });
}

function collectLines(
  stream: NodeJS.ReadableStream | null,
  source: 'stdout' | 'stderr',
  onLine: StreamingCommandInput['onLine'],
  append: (value: string) => void,
): string {
  if (!stream) return '';
  let buffered = '';
  stream.setEncoding('utf-8');
  stream.on('data', (chunk) => {
    const value = String(chunk);
    append(value);
    buffered += value;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onLine?.(trimmed, source);
    }
  });
  stream.on('end', () => {
    const trimmed = buffered.trim();
    if (trimmed) onLine?.(trimmed, source);
  });
  return '';
}
