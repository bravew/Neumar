import crypto from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getSetting } from '@/shared/db/operations';

import { JobLedger } from '../job-ledger';
import type { PublishEditAction, PublishJob, SourceArtifact } from '../types';
import { C2paToolRunner } from './c2patool-runner';
import { buildNeumaManifest } from './manifest-builder';
import {
  detectInboundManifest,
  loadContentCredentialsSdk,
  summarizeManifestStore,
} from './manifest-detector';
import { TEST_SIGNER_CERT_PEM, TEST_SIGNER_PRIVATE_KEY_PEM } from './test-cert';
import {
  CONTENT_CREDENTIALS_SDK_PACKAGE,
  CONTENT_CREDENTIALS_SDK_VERSION,
  C2PA_TECHNICAL_SPEC_VERSION,
  type C2paSignResult,
  type C2paSignRunner,
  type C2paSignerConfig,
  type C2paSignerMode,
  type ManifestIngredient,
  type NeumaManifest,
  type SupportedFormatSnapshot,
} from './types';

export interface PublishProvenanceServiceDeps {
  ledger?: JobLedger;
  runner?: C2paSignRunner;
  now?: () => Date;
  readSetting?: (key: string) => string | null;
  outputRoot?: string;
  appVersion?: string;
}

export class PublishProvenanceService {
  private readonly ledger: JobLedger;
  private readonly runner: C2paSignRunner;
  private readonly now: () => Date;
  private readonly readSetting: (key: string) => string | null;
  private readonly outputRoot?: string;
  private readonly appVersion: string;

  constructor(deps: PublishProvenanceServiceDeps = {}) {
    this.ledger = deps.ledger ?? new JobLedger();
    this.runner = deps.runner ?? new SdkOrToolC2paRunner();
    this.now = deps.now ?? (() => new Date());
    this.readSetting = deps.readSetting ?? getSetting;
    this.outputRoot = deps.outputRoot;
    this.appVersion =
      deps.appVersion ??
      process.env.NEUMAR_VERSION ??
      process.env.npm_package_version ??
      'dev';
  }

  async signOnce(jobId: string): Promise<C2paSignResult> {
    return this.ledger.withJobLock(jobId, async () => {
      const job = this.requireJob(jobId);
      const existing = this.existingSignedResult(job);
      if (existing) return existing;

      const signer = this.resolveSignerConfig();
      let inboundManifest;
      try {
        inboundManifest = await detectInboundManifest({
          sourcePath: job.source.path,
          mime: job.source.mime,
          sourceProvenance: job.source.provenance,
          reader: this.runner,
        });
        this.ledger.recordInboundManifest(
          job.id,
          inboundManifest as unknown as Record<string, unknown>,
        );

        const output = await this.outputPaths(job);
        const manifest = buildNeumaManifest({
          source: job.source,
          metadata: job.metadata,
          workspaceUserId: this.readSetting('userId'),
          appVersion: this.appVersion,
          signerMode: signer.mode,
          inboundManifest,
          trainingMiningOptOut: this.trainingMiningOptOut(),
          now: this.now(),
        });
        const result = await this.runner.sign({
          sourcePath: job.source.path,
          outputPath: output.signedArtifactPath,
          manifestPath: output.manifestPath,
          manifest,
          mode: signer.mode,
          signer,
        });
        this.ledger.recordProvenanceSigned(job.id, {
          signedArtifactPath: result.signedArtifactPath,
          manifestPath: result.manifestPath,
          contentSha256: result.contentSha256,
          manifestSha256: result.manifestSha256,
          signerMode: result.signerMode,
          runner: result.runner,
        });
        return result;
      } catch (error) {
        this.ledger.recordProvenanceFailed(
          job.id,
          error,
          inboundManifest as Record<string, unknown> | undefined,
        );
        throw error;
      }
    });
  }

  async signDerivative(input: {
    parentClaim: ManifestIngredient;
    source: SourceArtifact;
    metadata: PublishJob['metadata'];
    action?: PublishEditAction;
    outputRoot?: string;
  }): Promise<C2paSignResult> {
    const signer = this.resolveSignerConfig();
    const inboundManifest = {
      present: true,
      claimId: input.parentClaim.claimId,
      manifestDigest: input.parentClaim.manifestDigest,
      generator: input.parentClaim.generator,
      aiGenerated: true,
      valid: true,
    };
    const root =
      input.outputRoot ??
      this.outputRoot ??
      this.readSetting('workDir') ??
      path.dirname(input.source.path);
    const dir = path.join(
      root,
      '.neuma',
      'publish',
      'c2pa',
      `derivative-${input.source.sha256.slice(0, 16)}`,
    );
    await mkdir(dir, { recursive: true });
    const ext = path.extname(input.source.path);
    const basename = path.basename(input.source.path, ext);
    const manifest = buildNeumaManifest({
      source: input.source,
      metadata: input.metadata,
      workspaceUserId: this.readSetting('userId'),
      appVersion: this.appVersion,
      signerMode: signer.mode,
      inboundManifest,
      parentClaim: input.parentClaim,
      action: input.action ?? {
        action: 'c2pa.transcoded',
        when: this.now().toISOString(),
        softwareAgent: 'Neuma',
      },
      trainingMiningOptOut: this.trainingMiningOptOut(),
      now: this.now(),
    });

    return this.runner.sign({
      sourcePath: input.source.path,
      outputPath: path.join(dir, `${basename}.signed${ext}`),
      manifestPath: path.join(dir, 'manifest.c2pa.json'),
      manifest,
      mode: signer.mode,
      signer,
    });
  }

  async supportedFormats(): Promise<SupportedFormatSnapshot> {
    return this.runner.supportedFormats();
  }

  private requireJob(jobId: string): PublishJob {
    const job = this.ledger.getJob(jobId);
    if (!job) throw new Error(`Publish job not found: ${jobId}`);
    return job;
  }

  private existingSignedResult(job: PublishJob): C2paSignResult | null {
    const c2pa = (job.metadata as Record<string, unknown>).c2pa;
    if (!isRecord(c2pa)) return null;
    if (c2pa.content_sha256 !== job.source.sha256) return null;
    if (!job.signedArtifactPath || !job.manifestPath) return null;
    if (typeof c2pa.manifest_sha256 !== 'string') return null;
    return {
      signedArtifactPath: job.signedArtifactPath,
      manifestPath: job.manifestPath,
      manifestSha256: c2pa.manifest_sha256,
      contentSha256: job.source.sha256,
      embedded: true,
      signerMode: signerMode(c2pa.signer_mode),
      runner: isRecord(c2pa.runner)
        ? {
            sdkPackage:
              stringValue(c2pa.runner.sdkPackage) ??
              CONTENT_CREDENTIALS_SDK_PACKAGE,
            sdkVersion:
              stringValue(c2pa.runner.sdkVersion) ??
              CONTENT_CREDENTIALS_SDK_VERSION,
            toolVersion: stringValue(c2pa.runner.toolVersion),
            specVersion:
              stringValue(c2pa.runner.specVersion) ??
              C2PA_TECHNICAL_SPEC_VERSION,
          }
        : {
            sdkPackage: CONTENT_CREDENTIALS_SDK_PACKAGE,
            sdkVersion: CONTENT_CREDENTIALS_SDK_VERSION,
            specVersion: C2PA_TECHNICAL_SPEC_VERSION,
          },
    };
  }

  private async outputPaths(job: PublishJob): Promise<{
    signedArtifactPath: string;
    manifestPath: string;
  }> {
    const root =
      this.outputRoot ??
      this.readSetting('workDir') ??
      path.dirname(job.source.path);
    const dir = path.join(root, '.neuma', 'publish', 'c2pa', job.id);
    await mkdir(dir, { recursive: true });
    const ext = path.extname(job.source.path);
    const basename = path.basename(job.source.path, ext);
    return {
      signedArtifactPath: path.join(dir, `${basename}.signed${ext}`),
      manifestPath: path.join(dir, 'manifest.c2pa.json'),
    };
  }

  private resolveSignerConfig(): C2paSignerConfig {
    return resolveC2paSignerConfig(this.readSetting);
  }

  private trainingMiningOptOut(): boolean {
    return this.readSetting('publish.c2pa.trainingMiningOptOut') !== 'false';
  }
}

export class SdkOrToolC2paRunner implements C2paSignRunner {
  private readonly toolRunner: C2paToolRunner;

  constructor(toolRunner = new C2paToolRunner()) {
    this.toolRunner = toolRunner;
  }

  async readManifest(input: {
    sourcePath: string;
    mime: string;
    signal?: AbortSignal;
  }) {
    const sdk = await loadContentCredentialsSdk();
    const readerFactory = sdk?.Reader as
      | {
          fromAsset?: (
            asset: Record<string, unknown>,
            settings?: Record<string, unknown>,
          ) => Promise<{ json: () => unknown }>;
        }
      | undefined;
    if (readerFactory?.fromAsset) {
      const reader = await readerFactory.fromAsset(
        { path: input.sourcePath, mimeType: input.mime },
        { verify: { verify_after_reading: false, verify_trust: true } },
      );
      if (!reader) return null;
      return summarizeManifestStore(reader.json());
    }
    try {
      return await this.toolRunner.readManifest(input);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }
  }

  async sign(input: Parameters<C2paSignRunner['sign']>[0]) {
    const sdk = await loadContentCredentialsSdk();
    if (sdk?.Builder) return this.signWithSdk(sdk, input);
    return this.toolRunner.sign(input);
  }

  async supportedFormats(): Promise<SupportedFormatSnapshot> {
    return this.toolRunner.supportedFormats().catch(() => ({
      sdkPackage: CONTENT_CREDENTIALS_SDK_PACKAGE,
      sdkVersion: CONTENT_CREDENTIALS_SDK_VERSION,
      specVersion: C2PA_TECHNICAL_SPEC_VERSION,
      readMimePrefixes: ['image/', 'video/', 'audio/', 'application/pdf'],
      writeMimePrefixes: ['image/', 'video/', 'audio/', 'application/pdf'],
      fallbackRequiredMimeTypes: ['image/svg+xml'],
    }));
  }

  private async signWithSdk(
    sdk: Record<string, unknown>,
    input: Parameters<C2paSignRunner['sign']>[0],
  ): Promise<C2paSignResult> {
    await writeFile(
      input.manifestPath,
      JSON.stringify(input.manifest, null, 2),
    );
    const builderFactory = sdk.Builder as {
      withJson?: (manifest: Record<string, unknown>) => unknown;
    };
    const builder = builderFactory.withJson?.(
      toC2paManifestDefinition(input.manifest),
    );
    if (!builder || !isRecord(builder) || typeof builder.sign !== 'function') {
      throw new Error('Content Credentials SDK builder is unavailable');
    }
    const signer = sdkSigner(sdk, input.signer);
    await builder.sign(
      signer,
      { path: input.sourcePath },
      { path: input.outputPath },
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
        specVersion: C2PA_TECHNICAL_SPEC_VERSION,
      },
    };
  }
}

function sdkSigner(
  sdk: Record<string, unknown>,
  signer: C2paSignerConfig,
): unknown {
  if (signer.mode === 'cloud') {
    throw new Error('Cloud C2PA signer requires an injected runner');
  }
  const localSigner = sdk.LocalSigner as {
    newSigner?: (cert: Buffer, key: Buffer, alg: string) => unknown;
  };
  if (!localSigner?.newSigner) {
    throw new Error('Content Credentials SDK LocalSigner is unavailable');
  }
  if (signer.mode === 'workspace') {
    return localSigner.newSigner(
      Buffer.from(signer.certificatePem, 'utf8'),
      Buffer.from(signer.privateKeyPem, 'utf8'),
      'es256',
    );
  }
  return localSigner.newSigner(
    Buffer.from(TEST_SIGNER_CERT_PEM, 'utf8'),
    Buffer.from(TEST_SIGNER_PRIVATE_KEY_PEM, 'utf8'),
    'es256',
  );
}

function toC2paManifestDefinition(
  manifest: NeumaManifest,
): Record<string, unknown> {
  return {
    claim_generator: manifest.claimGenerator,
    claim_generator_info: manifest.claimGeneratorInfo,
    ingredients: manifest.ingredients.map((ingredient) => ({
      title: ingredient.title,
      relationship: ingredient.relationship,
      instance_id: ingredient.claimId,
      manifest_data: ingredient.manifestDigest
        ? { identifier: ingredient.manifestDigest }
        : undefined,
    })),
    assertions: [
      { label: 'c2pa.actions', data: manifest.assertions.actions },
      {
        label: 'c2pa.creative_work',
        data: manifest.assertions.creativeWork,
      },
      {
        label: 'c2pa.training_mining',
        data: manifest.assertions.trainingMining,
      },
      ...(manifest.assertions.aiGenerated
        ? [
            {
              label: 'c2pa.ai_generated_assertion',
              data: manifest.assertions.aiGenerated,
            },
          ]
        : []),
      {
        label: 'stds.schema-org.CreativeWork',
        data: manifest.assertions.schemaOrgCreativeWork,
      },
    ],
  };
}

async function sha256File(filePath: string): Promise<string> {
  return crypto
    .createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

/**
 * Resolve the C2PA signer config from workspace settings. Defaults to the
 * bundled `local-test` (untrusted) signer. Shared by the publish pipeline and
 * the video-export signer so both honour the same configuration keys.
 */
export function resolveC2paSignerConfig(
  readSetting: (key: string) => string | null,
): C2paSignerConfig {
  const mode = signerMode(
    readSetting('publish.c2pa.signerMode') ?? readSetting('c2paSignerMode'),
  );
  if (mode === 'workspace') {
    const raw = readSetting('c2pa:workspace-signer');
    const parsed = raw ? parseJson<Record<string, unknown>>(raw) : null;
    const certificatePem = stringValue(parsed?.certificatePem);
    const privateKeyPem = stringValue(parsed?.privateKeyPem);
    if (!certificatePem || !privateKeyPem) {
      throw new Error('Workspace C2PA signer is not configured');
    }
    return {
      mode,
      certificatePem,
      privateKeyPem,
      tsaUrl: stringValue(parsed?.tsaUrl),
    };
  }
  if (mode === 'cloud') {
    const raw = readSetting('c2pa:cloud-signer');
    const parsed = raw ? parseJson<Record<string, unknown>>(raw) : null;
    const endpoint = stringValue(parsed?.endpoint);
    if (!endpoint) throw new Error('Cloud C2PA signer is not configured');
    return {
      mode,
      endpoint,
      keyId: stringValue(parsed?.keyId),
      tsaUrl: stringValue(parsed?.tsaUrl),
    };
  }
  return { mode: 'local-test' };
}

function signerMode(value: unknown): C2paSignerMode {
  return value === 'workspace' || value === 'cloud' ? value : 'local-test';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> & {
  sign?: (...args: unknown[]) => unknown;
} {
  return typeof value === 'object' && value !== null;
}
