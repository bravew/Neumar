import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { z } from 'zod';

import {
  runStreamingCommand,
  StreamingCommandError,
  type StreamingCommandInput,
  type StreamingCommandResult,
} from '@/shared/process/run-streaming-command';
import { resolveHyperframesCommand } from '@/shared/services/design-mode/hyperframes-command';

const LifecycleResultSchema = z.object({
  schemaVersion: z.literal(1),
  operation: z.string(),
  ok: z.literal(true),
  result: z.object({
    state: z.string(),
    projectName: z.string(),
    projectDir: z.string(),
    host: z.literal('127.0.0.1'),
    port: z.number().int().min(1).max(65_535),
    serverUrl: z.string().url(),
    studioUrl: z.string().url(),
  }),
});

const LifecycleErrorSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  operation: z.string().optional(),
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});

const ServerContextSchema = z.object({
  ok: z.literal(true),
  server: z.object({
    port: z.number().int(),
    projectName: z.string(),
    projectDir: z.string(),
    url: z.string().url(),
  }),
});

const SelectionContextSchema = z.object({
  ok: z.literal(true),
  server: z.object({
    port: z.number().int(),
    projectName: z.string(),
    projectDir: z.string(),
    url: z.string().url(),
  }),
  selection: z
    .object({
      schemaVersion: z.number().int().optional(),
      projectId: z.string().optional(),
      compositionPath: z.string().optional(),
      sourceFile: z.string(),
      currentTime: z.number(),
      target: z.object({
        hfId: z.string().optional(),
        id: z.string().optional(),
        selector: z.string().optional(),
      }),
      label: z.string(),
      tagName: z.string().optional(),
      textContent: z.string().optional(),
      thumbnailUrl: z.string().url().optional(),
    })
    .nullable(),
  errors: z
    .record(z.string(), z.object({ code: z.string(), message: z.string() }))
    .optional(),
});

type RunCommand = (
  input: StreamingCommandInput,
) => Promise<StreamingCommandResult>;

export interface HyperframesStudioSession {
  projectDir: string;
  projectName: string;
  port: number;
  serverUrl: string;
  studioUrl: string;
  subscribers: number;
}

interface ManagedSession extends HyperframesStudioSession {
  subscriberIds: Set<string>;
}

export class HyperframesStudioError extends Error {
  constructor(
    public readonly code:
      | 'preview-not-running'
      | 'ambiguous-preview-server'
      | 'preview-port-mismatch'
      | 'no-selection'
      | 'malformed-json'
      | 'version-mismatch'
      | 'invalid-project'
      | 'preview-failed',
    message: string,
  ) {
    super(message);
    this.name = 'HyperframesStudioError';
  }
}

export class HyperframesStudioBridge {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly starts = new Map<string, Promise<ManagedSession>>();

  constructor(
    private readonly command = resolveHyperframesCommand(),
    private readonly runCommand: RunCommand = runStreamingCommand,
  ) {}

  async acquire(
    projectDir: string,
    subscriberId: string,
  ): Promise<HyperframesStudioSession> {
    const resolved = path.resolve(projectDir);
    await requireComposition(resolved);
    const existing = this.sessions.get(resolved);
    if (existing) {
      existing.subscriberIds.add(subscriberId);
      return sessionView(existing);
    }
    let start = this.starts.get(resolved);
    if (!start) {
      start = this.start(resolved);
      this.starts.set(resolved, start);
    }
    try {
      const session = await start;
      session.subscriberIds.add(subscriberId);
      return sessionView(session);
    } finally {
      this.starts.delete(resolved);
    }
  }

  private async start(resolved: string): Promise<ManagedSession> {
    const port = await allocateLoopbackPort();
    const payload = await this.runJson(
      [
        'preview',
        resolved,
        '--background',
        '--port',
        String(port),
        '--no-open',
        '--json',
      ],
      resolved,
    );
    const parsed = LifecycleResultSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HyperframesStudioError(
        'malformed-json',
        'HyperFrames returned an invalid preview lifecycle payload.',
      );
    }
    if (parsed.data.result.port !== port) {
      throw new HyperframesStudioError(
        'preview-port-mismatch',
        `HyperFrames started on ${parsed.data.result.port}, expected ${port}.`,
      );
    }
    const session: ManagedSession = {
      projectDir: resolved,
      projectName: parsed.data.result.projectName,
      port,
      serverUrl: parsed.data.result.serverUrl,
      studioUrl: parsed.data.result.studioUrl,
      subscribers: 0,
      subscriberIds: new Set(),
    };
    this.sessions.set(resolved, session);
    return session;
  }

  async status(projectDir: string): Promise<HyperframesStudioSession | null> {
    const resolved = path.resolve(projectDir);
    const session = this.sessions.get(resolved);
    if (!session) return null;
    const payload = await this.runJson(
      [
        'preview',
        resolved,
        '--context',
        '--context-fields',
        'server',
        '--port',
        String(session.port),
        '--json',
      ],
      resolved,
    );
    const parsed = ServerContextSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HyperframesStudioError(
        'malformed-json',
        'HyperFrames returned invalid Studio server context.',
      );
    }
    if (parsed.data.server.port !== session.port) {
      throw new HyperframesStudioError(
        'preview-port-mismatch',
        `HyperFrames reported port ${parsed.data.server.port}, expected ${session.port}.`,
      );
    }
    return sessionView(session);
  }

  async release(projectDir: string, subscriberId: string): Promise<boolean> {
    const resolved = path.resolve(projectDir);
    const session = this.sessions.get(resolved);
    if (!session) return false;
    if (!session.subscriberIds.delete(subscriberId)) return false;
    if (session.subscriberIds.size > 0) return false;
    this.sessions.delete(resolved);
    await this.runJson(
      ['preview', resolved, '--stop', '--port', String(session.port), '--json'],
      resolved,
    );
    return true;
  }

  async getSelection(projectDir: string) {
    const resolved = path.resolve(projectDir);
    const session = this.sessions.get(resolved);
    if (!session) {
      throw new HyperframesStudioError(
        'preview-not-running',
        'No managed HyperFrames Studio preview is running for this project.',
      );
    }
    const payload = await this.runJson(
      [
        'preview',
        resolved,
        '--context',
        '--context-fields',
        'server,selection',
        '--port',
        String(session.port),
        '--json',
      ],
      resolved,
    );
    const parsed = SelectionContextSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HyperframesStudioError(
        'malformed-json',
        'HyperFrames returned invalid Studio selection context.',
      );
    }
    if (!parsed.data.selection) {
      const selectionError = parsed.data.errors?.selection;
      throw new HyperframesStudioError(
        selectionError?.code === 'no-selection'
          ? 'no-selection'
          : 'preview-failed',
        selectionError?.message ?? 'Studio has no selected element.',
      );
    }
    const target = parsed.data.selection.target;
    return {
      ...parsed.data.selection,
      stableTarget: target.hfId ?? target.id ?? target.selector,
      studioUrl: session.studioUrl,
    };
  }

  private async runJson(args: string[], cwd: string): Promise<unknown> {
    try {
      const result = await this.runCommand({
        bin: this.command,
        args,
        cwd,
        timeoutMs: 30_000,
      });
      return parseJson(result.stdout);
    } catch (error) {
      if (error instanceof StreamingCommandError && error.stdout) {
        const payload = parseJson(error.stdout);
        const parsed = LifecycleErrorSchema.safeParse(payload);
        if (parsed.success) {
          throw mapStudioError(
            parsed.data.error.code,
            parsed.data.error.message,
          );
        }
      }
      throw new HyperframesStudioError(
        'preview-failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function sessionView(session: ManagedSession): HyperframesStudioSession {
  return {
    projectDir: session.projectDir,
    projectName: session.projectName,
    port: session.port,
    serverUrl: session.serverUrl,
    studioUrl: session.studioUrl,
    subscribers: session.subscriberIds.size,
  };
}

let singleton: HyperframesStudioBridge | undefined;

export function getHyperframesStudioBridge(): HyperframesStudioBridge {
  singleton ??= new HyperframesStudioBridge();
  return singleton;
}

export function resolveHyperframesStudioProjectDir(
  projectRoot: string,
  relativeDir = 'hyperframes',
): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, relativeDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new HyperframesStudioError(
      'invalid-project',
      'HyperFrames composition directory must stay inside the video project.',
    );
  }
  return resolved;
}

async function requireComposition(projectDir: string): Promise<void> {
  const stat = await fs
    .stat(path.join(projectDir, 'index.html'))
    .catch(() => null);
  if (!stat?.isFile()) {
    throw new HyperframesStudioError(
      'invalid-project',
      `HyperFrames composition requires index.html in ${projectDir}.`,
    );
  }
}

function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate a loopback preview port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new HyperframesStudioError(
      'malformed-json',
      'HyperFrames returned malformed JSON.',
    );
  }
}

function mapStudioError(code: string, message: string): HyperframesStudioError {
  if (
    code === 'preview-not-running' ||
    code === 'ambiguous-preview-server' ||
    code === 'preview-port-mismatch' ||
    code === 'no-selection'
  ) {
    return new HyperframesStudioError(code, message);
  }
  if (code === 'version-mismatch') {
    return new HyperframesStudioError('version-mismatch', message);
  }
  return new HyperframesStudioError('preview-failed', message);
}
