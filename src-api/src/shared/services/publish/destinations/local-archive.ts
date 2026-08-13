import { copyFile, link, mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

import type {
  DestinationCapabilities,
  LegContext,
  PublishedRef,
  PublishedStatus,
  PublishDestinationAdapter,
  PublishLegInput,
  PublishLegPlan,
  UploadHandle,
} from '../types';

export interface LocalArchiveAdapterOptions {
  rootDir?: string;
  now?: () => Date;
  indexFile?: (filePath: string) => Promise<void>;
}

export class LocalArchiveAdapter implements PublishDestinationAdapter {
  readonly kind = 'local-archive' as const;

  private readonly rootDir: string;
  private readonly now: () => Date;
  private readonly indexFile?: (filePath: string) => Promise<void>;

  constructor(options: LocalArchiveAdapterOptions = {}) {
    this.rootDir = options.rootDir ?? path.join(homedir(), '.neuma', 'archive');
    this.now = options.now ?? (() => new Date());
    this.indexFile = options.indexFile;
  }

  capabilities(): DestinationCapabilities {
    return {
      supportsResumable: false,
      supportsVersioning: true,
      requiresReformat: false,
      acceptedMimePrefixes: [
        'image/',
        'video/',
        'audio/',
        'text/',
        'application/',
      ],
      approvalDefault: false,
    };
  }

  async plan(input: PublishLegInput): Promise<PublishLegPlan> {
    const targetPath = archiveDirFor({
      rootDir: this.rootDir,
      now: this.now(),
      sha256: input.source.sha256,
      title: input.metadata.title ?? path.basename(input.source.path),
    });
    return {
      destinationKind: this.kind,
      targetRef: targetPath,
      targetPath,
      uploadBytes: input.source.sizeBytes,
      estimatedBytes: input.source.sizeBytes,
      willReformat: false,
      requiresApproval: input.destination.approvalRequired,
    };
  }

  async upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle> {
    const plan = await this.plan(input);
    const targetDir = plan.targetPath ?? this.rootDir;
    await mkdir(targetDir, { recursive: true });

    const artifactName = path.basename(input.source.path);
    const artifactTarget = path.join(targetDir, artifactName);
    await linkOrCopy(input.source.path, artifactTarget);
    await writeManifestSidecar(
      input,
      path.join(targetDir, 'manifest.c2pa.json'),
    );
    await writeFile(
      path.join(targetDir, 'publish.json'),
      JSON.stringify(
        {
          jobId: input.jobId,
          legId: input.legId,
          destinationKind: this.kind,
          source: input.source,
          metadata: input.metadata,
          archivedAt: this.now().toISOString(),
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(targetDir, 'provenance.txt'),
      provenanceText(input, this.now()),
    );
    await this.indexFile?.(artifactTarget);

    ctx.recordChunkProgress(input.source.sizeBytes);
    return {
      sessionId: targetDir,
      offsetBytes: input.source.sizeBytes,
      providerState: {
        ref: {
          providerId: targetDir,
          url: `file://${artifactTarget}`,
          metadata: { artifactPath: artifactTarget },
        },
      },
    };
  }

  async finalize(handle: UploadHandle): Promise<PublishedRef> {
    return handle.providerState?.ref as PublishedRef;
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }

  async abort(): Promise<void> {
    return;
  }
}

async function writeManifestSidecar(
  input: PublishLegInput,
  targetPath: string,
): Promise<void> {
  if (input.source.manifestPath) {
    try {
      await writeFile(targetPath, await readFile(input.source.manifestPath));
      return;
    } catch {
      // Fall back to an explicit placeholder; archive should not fail because a
      // sidecar was moved by a later provenance retry.
    }
  }
  await writeFile(
    targetPath,
    JSON.stringify(
      { status: 'placeholder', sourceSha256: input.source.sha256 },
      null,
      2,
    ),
  );
}

function archiveDirFor(input: {
  rootDir: string;
  now: Date;
  sha256: string;
  title: string;
}): string {
  const year = String(input.now.getUTCFullYear());
  const month = String(input.now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(input.now.getUTCDate()).padStart(2, '0');
  return path.join(
    input.rootDir,
    year,
    month,
    day,
    `${input.sha256.slice(0, 8)}-${slug(input.title)}`,
  );
}

async function linkOrCopy(source: string, target: string): Promise<void> {
  try {
    await link(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EEXIST') throw error;
    if (code === 'EXDEV') await copyFile(source, target);
  }
}

function provenanceText(input: PublishLegInput, now: Date): string {
  return [
    `Archived at: ${now.toISOString()}`,
    `Job: ${input.jobId}`,
    `Leg: ${input.legId}`,
    `Source: ${input.source.path}`,
    `SHA-256: ${input.source.sha256}`,
    `MIME: ${input.source.mime}`,
  ].join('\n');
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'artifact'
  );
}
