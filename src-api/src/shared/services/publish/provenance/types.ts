import type {
  DestinationKind,
  PublishEditAction,
  SourceArtifact,
} from '../types';

export const CONTENT_CREDENTIALS_SDK_PACKAGE = '@contentauth/c2pa-node';
export const CONTENT_CREDENTIALS_SDK_VERSION = '0.5.5';
export const C2PA_TECHNICAL_SPEC_VERSION = '2.4';

export type C2paSignerMode = 'local-test' | 'workspace' | 'cloud';

export interface InboundManifestInfo {
  present: boolean;
  invalid?: boolean;
  reason?: string;
  generator?: string;
  model?: string;
  prompt?: string;
  signedBy?: string;
  valid?: boolean;
  claimId?: string;
  manifestDigest?: string;
  aiGenerated?: boolean;
  sdkVersion?: string;
  toolVersion?: string;
  specVersion?: string;
  raw?: unknown;
}

export interface ManifestIngredient {
  title: string;
  relationship: 'parentOf' | 'componentOf' | 'inputTo' | 'unknown';
  claimId?: string;
  manifestDigest?: string;
  generator?: string;
}

export interface CreativeWorkAssertion {
  title: string;
  description?: string;
  author?: string;
  tags?: string[];
}

export interface NeumaManifest {
  claimGenerator: string;
  claimGeneratorInfo: Array<{ name: string; version: string }>;
  contentSha256: string;
  source: Pick<
    SourceArtifact,
    'artifactId' | 'path' | 'sha256' | 'sizeBytes' | 'mime'
  >;
  createdAt: string;
  signerMode: C2paSignerMode;
  aiGenerated: boolean;
  inboundManifest?: InboundManifestInfo;
  parentClaim?: ManifestIngredient;
  ingredients: ManifestIngredient[];
  assertions: {
    actions: { actions: PublishEditAction[] };
    creativeWork: CreativeWorkAssertion;
    trainingMining: {
      dataMining: 'notAllowed' | 'allowed';
      aiTraining: 'notAllowed' | 'allowed';
    };
    aiGenerated?: {
      declared: true;
      sources: string[];
    };
    schemaOrgCreativeWork: CreativeWorkAssertion & {
      '@context': 'https://schema.org';
      '@type': 'CreativeWork';
    };
  };
  tool: {
    packageName: string;
    packageVersion: string;
    specVersion: string;
  };
}

export interface SupportedFormatSnapshot {
  sdkPackage: string;
  sdkVersion: string;
  toolVersion?: string;
  specVersion: string;
  readMimePrefixes: string[];
  writeMimePrefixes: string[];
  fallbackRequiredMimeTypes: string[];
}

export interface C2paSignRunner {
  readManifest(input: {
    sourcePath: string;
    mime: string;
    signal?: AbortSignal;
  }): Promise<InboundManifestInfo | null>;
  sign(input: {
    sourcePath: string;
    outputPath: string;
    manifestPath: string;
    manifest: NeumaManifest;
    mode: C2paSignerMode;
    signer: C2paSignerConfig;
    signal?: AbortSignal;
  }): Promise<C2paSignResult>;
  supportedFormats(): Promise<SupportedFormatSnapshot>;
}

export type C2paSignerConfig =
  | { mode: 'local-test' }
  | {
      mode: 'workspace';
      certificatePem: string;
      privateKeyPem: string;
      tsaUrl?: string;
    }
  | {
      mode: 'cloud';
      endpoint: string;
      keyId?: string;
      tsaUrl?: string;
    };

export interface C2paSignResult {
  signedArtifactPath: string;
  manifestPath: string;
  manifestSha256: string;
  contentSha256: string;
  embedded: boolean;
  signerMode: C2paSignerMode;
  runner: {
    sdkPackage: string;
    sdkVersion: string;
    toolVersion?: string;
    specVersion: string;
  };
}

export type DisclosureFields = Record<string, unknown>;

export type DisclosureMapping = Partial<
  Record<DestinationKind, DisclosureFields>
>;
