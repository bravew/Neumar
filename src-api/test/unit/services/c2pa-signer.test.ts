import crypto from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migration as migration019 } from '@/shared/db/migrations/019_publish_tables';
import { runMigrations } from '@/shared/db/migrations/runner';
import { JobLedger } from '@/shared/services/publish/job-ledger';
import {
  CorruptC2paManifestError,
  PublishProvenanceService,
} from '@/shared/services/publish/provenance';
import type {
  C2paSignResult,
  C2paSignRunner,
  C2paSignerMode,
  InboundManifestInfo,
  NeumaManifest,
  SupportedFormatSnapshot,
} from '@/shared/services/publish/provenance';
import type { CreateJobInput } from '@/shared/services/publish/types';

class FakeC2paRunner implements C2paSignRunner {
  signCalls = 0;
  modes: C2paSignerMode[] = [];
  manifests: NeumaManifest[] = [];

  constructor(
    private readonly inbound: InboundManifestInfo | Error | null = {
      present: true,
      generator: 'UpstreamAI/1.0',
      model: 'video-gen-1',
      signedBy: 'Example CA',
      valid: true,
      claimId: 'claim:upstream',
      manifestDigest: 'digest:upstream',
      aiGenerated: true,
    },
  ) {}

  async readManifest(): Promise<InboundManifestInfo | null> {
    if (this.inbound instanceof Error) throw this.inbound;
    return this.inbound;
  }

  async sign(
    input: Parameters<C2paSignRunner['sign']>[0],
  ): Promise<C2paSignResult> {
    this.signCalls += 1;
    this.modes.push(input.mode);
    this.manifests.push(input.manifest);
    const source = await readFile(input.sourcePath);
    await writeFileAtomic(input.outputPath, source);
    await writeFileAtomic(
      input.manifestPath,
      Buffer.from(JSON.stringify(input.manifest, null, 2)),
    );
    return {
      signedArtifactPath: input.outputPath,
      manifestPath: input.manifestPath,
      manifestSha256: sha256(Buffer.from(JSON.stringify(input.manifest))),
      contentSha256: input.manifest.contentSha256,
      embedded: true,
      signerMode: input.mode,
      runner: {
        sdkPackage: '@contentauth/c2pa-node',
        sdkVersion: '0.5.5',
        specVersion: '2.4',
      },
    };
  }

  async supportedFormats(): Promise<SupportedFormatSnapshot> {
    return {
      sdkPackage: '@contentauth/c2pa-node',
      sdkVersion: '0.5.5',
      specVersion: '2.4',
      readMimePrefixes: ['video/'],
      writeMimePrefixes: ['video/'],
      fallbackRequiredMimeTypes: ['image/svg+xml'],
    };
  }
}

describe('C2PA signer', () => {
  it('preserves inbound manifests and appends the edit chain', async () => {
    const fixture = createFixture();
    try {
      const runner = new FakeC2paRunner();
      const { ledger, service, job } = createService(fixture, runner, {
        metadata: {
          title: 'Launch video',
          description: 'A generated launch clip',
          editActions: [
            {
              action: 'c2pa.actions.ingested',
              when: '2026-05-06T10:00:00.000Z',
            },
            {
              action: 'c2pa.actions.cropped',
              when: '2026-05-06T10:05:00.000Z',
            },
            {
              action: 'c2pa.actions.exported',
              when: '2026-05-06T10:10:00.000Z',
            },
          ],
        },
      });

      const result = await service.signOnce(job.id);
      const signed = ledger.getJob(job.id);
      const manifest = JSON.parse(
        await readFile(result.manifestPath, 'utf8'),
      ) as NeumaManifest;

      expect(signed?.provenanceState).toBe('signed');
      expect(signed?.manifestPath).toBe(result.manifestPath);
      expect(manifest.ingredients).toEqual([
        expect.objectContaining({
          claimId: 'claim:upstream',
          manifestDigest: 'digest:upstream',
        }),
      ]);
      expect(manifest.assertions.actions.actions).toHaveLength(3);
      expect(manifest.aiGenerated).toBe(true);
      expect(manifest.claimGenerator).toContain('@contentauth/c2pa-node/0.5.5');
      expect(manifest.claimGeneratorInfo).toEqual([
        { name: 'Neuma', version: '26.5.10' },
      ]);
    } finally {
      fixture.close();
    }
  });

  it('records corrupt inbound manifests and signs anyway', async () => {
    const fixture = createFixture();
    try {
      const runner = new FakeC2paRunner(
        new CorruptC2paManifestError('corrupt JUMBF box'),
      );
      const { ledger, service, job } = createService(fixture, runner);

      await service.signOnce(job.id);
      const signed = ledger.getJob(job.id);

      expect(signed?.provenanceState).toBe('signed');
      const metadata = signed?.metadata as Record<string, unknown>;
      expect(
        (metadata.inbound_manifest as Record<string, unknown>).invalid,
      ).toBe(true);
      expect(runner.signCalls).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('switches between local test, workspace, and cloud signer modes', async () => {
    const fixture = createFixture();
    try {
      const runner = new FakeC2paRunner(null);
      const modes: C2paSignerMode[] = ['local-test', 'workspace', 'cloud'];

      for (const mode of modes) {
        const { service, job } = createService(fixture, runner, {
          id: `job-${mode}`,
          readSetting: settingReaderForMode(fixture.dir, mode),
        });
        await service.signOnce(job.id);
      }

      expect(runner.modes).toEqual(modes);
      expect(runner.manifests.map((manifest) => manifest.signerMode)).toEqual(
        modes,
      );
    } finally {
      fixture.close();
    }
  });

  it('is idempotent for retries of the same content hash', async () => {
    const fixture = createFixture();
    try {
      const runner = new FakeC2paRunner();
      const { service, job } = createService(fixture, runner);

      const first = await service.signOnce(job.id);
      const second = await service.signOnce(job.id);

      expect(second).toEqual(first);
      expect(runner.signCalls).toBe(1);
    } finally {
      fixture.close();
    }
  });
});

function createFixture(): {
  db: Database.Database;
  dir: string;
  sourcePath: string;
  sha256: string;
  close(): void;
} {
  const dir = mkdtempSync(path.join(tmpdir(), 'c2pa-signer-'));
  const sourcePath = path.join(dir, 'video.mp4');
  const bytes = Buffer.from('fake video bytes');
  writeFileSync(sourcePath, bytes);
  const db = new Database(':memory:');
  runMigrations(db, [migration019]);
  return {
    db,
    dir,
    sourcePath,
    sha256: sha256(bytes),
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createService(
  fixture: ReturnType<typeof createFixture>,
  runner: FakeC2paRunner,
  options: {
    id?: string;
    metadata?: CreateJobInput['metadata'];
    readSetting?: (key: string) => string | null;
  } = {},
): {
  ledger: JobLedger;
  service: PublishProvenanceService;
  job: ReturnType<JobLedger['createJob']>;
} {
  const ledger = new JobLedger({
    db: fixture.db,
    now: () => new Date('2026-05-06T12:00:00.000Z'),
  });
  const input: CreateJobInput = {
    id: options.id,
    idempotencyKey: options.id,
    workspaceId: 'workspace-1',
    createdBy: 'human:user-1',
    source: {
      artifactId: 'artifact-1',
      path: fixture.sourcePath,
      sha256: fixture.sha256,
      sizeBytes: 16,
      mime: 'video/mp4',
      provenance: {
        provider: 'neuma',
        model: 'video-gen-1',
        aiGenerated: true,
      },
    },
    metadata: options.metadata ?? { title: 'Launch video' },
    destinations: [
      {
        kind: 'local-archive',
        connectionId: 'local',
        approvalRequired: false,
      },
    ],
  };
  const job = ledger.createJob(input);
  const service = new PublishProvenanceService({
    ledger,
    runner,
    now: () => new Date('2026-05-06T12:00:00.000Z'),
    outputRoot: fixture.dir,
    appVersion: '26.5.10',
    readSetting:
      options.readSetting ?? settingReaderForMode(fixture.dir, 'local-test'),
  });
  return { ledger, service, job };
}

function settingReaderForMode(
  dir: string,
  mode: C2paSignerMode,
): (key: string) => string | null {
  return (key) => {
    if (key === 'workDir') return dir;
    if (key === 'userId') return 'user-1';
    if (key === 'publish.c2pa.signerMode') return mode;
    if (key === 'c2pa:workspace-signer') {
      return JSON.stringify({
        certificatePem: 'workspace-cert',
        privateKeyPem: 'workspace-key',
      });
    }
    if (key === 'c2pa:cloud-signer') {
      return JSON.stringify({ endpoint: 'https://signer.example.test' });
    }
    return null;
  };
}

async function writeFileAtomic(filePath: string, bytes: Buffer): Promise<void> {
  await writeFile(filePath, bytes);
}

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
