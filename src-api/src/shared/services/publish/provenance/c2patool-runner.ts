import { spawn } from 'child_process';
import crypto from 'crypto';
import { readFile, writeFile } from 'fs/promises';

import { summarizeManifestStore } from './manifest-detector';
import {
  CONTENT_CREDENTIALS_SDK_PACKAGE,
  CONTENT_CREDENTIALS_SDK_VERSION,
  C2PA_TECHNICAL_SPEC_VERSION,
  type C2paSignResult,
  type C2paSignRunner,
  type InboundManifestInfo,
  type SupportedFormatSnapshot,
} from './types';

export interface C2paToolRunnerOptions {
  binary?: string;
  env?: NodeJS.ProcessEnv;
}

export class C2paToolRunner implements C2paSignRunner {
  private readonly binary: string;
  private readonly env?: NodeJS.ProcessEnv;

  constructor(options: C2paToolRunnerOptions = {}) {
    this.binary = options.binary ?? 'c2patool';
    this.env = options.env;
  }

  async readManifest(input: {
    sourcePath: string;
    mime: string;
  }): Promise<InboundManifestInfo | null> {
    const result = await runCommand(this.binary, [input.sourcePath, '--json'], {
      env: this.env,
    });
    if (!result.stdout.trim()) return null;
    return summarizeManifestStore(JSON.parse(result.stdout));
  }

  async sign(
    input: Parameters<C2paSignRunner['sign']>[0],
  ): Promise<C2paSignResult> {
    await writeFile(
      input.manifestPath,
      JSON.stringify(input.manifest, null, 2),
    );
    await runCommand(
      this.binary,
      [
        input.sourcePath,
        '--manifest',
        input.manifestPath,
        '--output',
        input.outputPath,
      ],
      { env: this.env },
    );

    return {
      signedArtifactPath: input.outputPath,
      manifestPath: input.manifestPath,
      manifestSha256: await sha256File(input.manifestPath),
      contentSha256: await sha256File(input.outputPath),
      embedded: true,
      signerMode: input.mode,
      runner: {
        sdkPackage: CONTENT_CREDENTIALS_SDK_PACKAGE,
        sdkVersion: CONTENT_CREDENTIALS_SDK_VERSION,
        toolVersion: await this.version().catch(() => undefined),
        specVersion: C2PA_TECHNICAL_SPEC_VERSION,
      },
    };
  }

  async supportedFormats(): Promise<SupportedFormatSnapshot> {
    return {
      sdkPackage: CONTENT_CREDENTIALS_SDK_PACKAGE,
      sdkVersion: CONTENT_CREDENTIALS_SDK_VERSION,
      toolVersion: await this.version().catch(() => undefined),
      specVersion: C2PA_TECHNICAL_SPEC_VERSION,
      readMimePrefixes: ['image/', 'video/', 'audio/', 'application/pdf'],
      writeMimePrefixes: ['image/', 'video/', 'audio/', 'application/pdf'],
      fallbackRequiredMimeTypes: ['image/svg+xml'],
    };
  }

  async version(): Promise<string> {
    const result = await runCommand(this.binary, ['--version'], {
      env: this.env,
    });
    return result.stdout.trim() || result.stderr.trim();
  }
}

function runCommand(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code === 0) {
        resolve({ stdout: out, stderr: err });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed with code ${code}: ${err}`,
        ),
      );
    });
  });
}

async function sha256File(path: string): Promise<string> {
  return crypto
    .createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
