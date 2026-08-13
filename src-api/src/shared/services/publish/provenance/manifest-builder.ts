import path from 'path';

import type {
  PublishEditAction,
  PublishMetadata,
  SourceArtifact,
} from '../types';
import {
  CONTENT_CREDENTIALS_SDK_PACKAGE,
  CONTENT_CREDENTIALS_SDK_VERSION,
  C2PA_TECHNICAL_SPEC_VERSION,
  type C2paSignerMode,
  type InboundManifestInfo,
  type ManifestIngredient,
  type NeumaManifest,
} from './types';

export interface ManifestBuilderInput {
  source: SourceArtifact;
  metadata: PublishMetadata;
  workspaceUserId?: string | null;
  appVersion: string;
  signerMode: C2paSignerMode;
  inboundManifest: InboundManifestInfo;
  parentClaim?: ManifestIngredient;
  action?: PublishEditAction;
  trainingMiningOptOut?: boolean;
  now?: Date;
}

export function buildNeumaManifest(input: ManifestBuilderInput): NeumaManifest {
  const createdAt = (input.now ?? new Date()).toISOString();
  const actions = actionsFor(input, createdAt);
  const creativeWork = {
    title:
      input.metadata.creativeWork?.title ??
      input.metadata.title ??
      path.basename(input.source.path),
    description:
      input.metadata.creativeWork?.description ?? input.metadata.description,
    author:
      input.metadata.creativeWork?.author ??
      input.workspaceUserId ??
      'workspace-user',
    tags: input.metadata.tags,
  };
  const aiSources = aiGeneratedSources(input);
  const ingredients = ingredientChain(input);

  return {
    claimGenerator: `Neuma/${input.appVersion} ${CONTENT_CREDENTIALS_SDK_PACKAGE}/${CONTENT_CREDENTIALS_SDK_VERSION}`,
    claimGeneratorInfo: [{ name: 'Neuma', version: input.appVersion }],
    contentSha256: input.source.sha256,
    source: {
      artifactId: input.source.artifactId,
      path: input.source.path,
      sha256: input.source.sha256,
      sizeBytes: input.source.sizeBytes,
      mime: input.source.mime,
    },
    createdAt,
    signerMode: input.signerMode,
    aiGenerated: aiSources.length > 0,
    inboundManifest: input.inboundManifest,
    parentClaim: input.parentClaim,
    ingredients,
    assertions: {
      actions: { actions },
      creativeWork,
      trainingMining: {
        dataMining:
          input.trainingMiningOptOut === false ? 'allowed' : 'notAllowed',
        aiTraining:
          input.trainingMiningOptOut === false ? 'allowed' : 'notAllowed',
      },
      aiGenerated: aiSources.length
        ? { declared: true, sources: aiSources }
        : undefined,
      schemaOrgCreativeWork: {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        ...creativeWork,
      },
    },
    tool: {
      packageName: CONTENT_CREDENTIALS_SDK_PACKAGE,
      packageVersion: CONTENT_CREDENTIALS_SDK_VERSION,
      specVersion: C2PA_TECHNICAL_SPEC_VERSION,
    },
  };
}

function actionsFor(
  input: ManifestBuilderInput,
  createdAt: string,
): PublishEditAction[] {
  const sourceActions = input.metadata.editActions?.length
    ? input.metadata.editActions
    : [
        {
          action: 'c2pa.actions.exported',
          when: createdAt,
          softwareAgent: 'Neuma',
        },
      ];
  const action = input.action;
  return action ? [...sourceActions, action] : sourceActions;
}

function aiGeneratedSources(input: ManifestBuilderInput): string[] {
  const sources = new Set<string>();
  if (input.inboundManifest.aiGenerated) sources.add('inbound_manifest');
  if (input.source.provenance?.aiGenerated) {
    sources.add(input.source.provenance.provider ?? 'source_provenance');
  }
  if (input.metadata.generatedByNeumaAgent || input.metadata.aiGenerated) {
    sources.add('neuma_agent');
  }
  return [...sources];
}

function ingredientChain(input: ManifestBuilderInput): ManifestIngredient[] {
  const ingredients: ManifestIngredient[] = [];
  if (input.parentClaim) {
    ingredients.push(input.parentClaim);
  }
  if (input.inboundManifest.present && !input.inboundManifest.invalid) {
    ingredients.push({
      title:
        input.inboundManifest.generator ??
        input.source.provenance?.claimGenerator ??
        path.basename(input.source.path),
      relationship: 'parentOf',
      claimId: input.inboundManifest.claimId,
      manifestDigest: input.inboundManifest.manifestDigest,
      generator: input.inboundManifest.generator,
    });
  }
  return ingredients;
}
