import { randomUUID } from 'node:crypto';

import { getProject, updateProjectDocument } from '@/shared/video/store';
import type { AnalysisArtifact, VideoProject } from '@/shared/video/types';

export interface VideoResearchCitation {
  title: string;
  url: string;
  fetchedAt?: string;
}

export interface VideoResearchBrief {
  topic: string;
  depth?: 'quick' | 'standard' | 'deep';
  findings: string[];
  facts?: Record<string, string>;
  suggestedBeats?: string[];
  citations: VideoResearchCitation[];
  createdAt: string;
}

export interface RecordVideoResearchBriefInput {
  topic: string;
  depth?: 'quick' | 'standard' | 'deep';
  findings: string[];
  facts?: Record<string, string>;
  suggestedBeats?: string[];
  citations?: VideoResearchCitation[];
}

const RESEARCH_BRIEF_METADATA_TYPE = 'video-research-brief';
const MAX_RESEARCH_BRIEFS = 5;

export async function recordVideoResearchBrief(
  projectId: string,
  input: RecordVideoResearchBriefInput,
): Promise<{ project: VideoProject; brief: VideoResearchBrief }> {
  const brief = normalizeResearchBrief(input);
  const project = await updateProjectDocument(projectId, (current) => {
    const existing = current.analysisArtifacts ?? [];
    const previousResearchBriefs = existing
      .filter(isResearchBriefArtifact)
      .slice(0, MAX_RESEARCH_BRIEFS - 1);
    const otherArtifacts = existing.filter(
      (artifact) => !isResearchBriefArtifact(artifact),
    );
    return {
      ...current,
      analysisArtifacts: [
        researchBriefArtifact(brief),
        ...previousResearchBriefs,
        ...otherArtifacts,
      ],
      updatedAt: brief.createdAt,
    };
  });
  return { project, brief };
}

export async function readLatestVideoResearchBrief(
  projectId: string,
): Promise<VideoResearchBrief | undefined> {
  return getLatestVideoResearchBrief(await getProject(projectId));
}

export function getLatestVideoResearchBrief(
  project: Pick<VideoProject, 'analysisArtifacts'>,
): VideoResearchBrief | undefined {
  return (project.analysisArtifacts ?? [])
    .map((artifact) => artifactToResearchBrief(artifact))
    .filter((brief): brief is VideoResearchBrief => Boolean(brief))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function normalizeResearchBrief(
  input: RecordVideoResearchBriefInput,
): VideoResearchBrief {
  const topic = input.topic.trim();
  if (!topic) throw new Error('Research topic is required.');
  const findings = input.findings
    .map((finding) => finding.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (findings.length === 0) {
    throw new Error('At least one research finding is required.');
  }
  const citations = (input.citations ?? [])
    .map((citation) => ({
      title: citation.title.trim() || citation.url.trim(),
      url: citation.url.trim(),
      fetchedAt: citation.fetchedAt,
    }))
    .filter((citation) => citation.url)
    .slice(0, 20);
  return {
    topic,
    depth: input.depth,
    findings,
    facts: normalizeFacts(input.facts),
    suggestedBeats: input.suggestedBeats
      ?.map((beat) => beat.trim())
      .filter(Boolean)
      .slice(0, 20),
    citations,
    createdAt: new Date().toISOString(),
  };
}

function researchBriefArtifact(brief: VideoResearchBrief): AnalysisArtifact {
  return {
    id: randomUUID(),
    kind: 'custom',
    summary: `Research brief: ${brief.topic}`,
    metadata: {
      type: RESEARCH_BRIEF_METADATA_TYPE,
      brief,
    },
    generatedAt: brief.createdAt,
  };
}

function artifactToResearchBrief(
  artifact: AnalysisArtifact,
): VideoResearchBrief | undefined {
  if (!isResearchBriefArtifact(artifact)) return undefined;
  const brief = artifact.metadata.brief;
  if (!isResearchBrief(brief)) return undefined;
  return brief;
}

function isResearchBriefArtifact(
  artifact: AnalysisArtifact,
): artifact is AnalysisArtifact & {
  metadata: { type: typeof RESEARCH_BRIEF_METADATA_TYPE; brief?: unknown };
} {
  return (
    artifact.kind === 'custom' &&
    artifact.metadata?.type === RESEARCH_BRIEF_METADATA_TYPE
  );
}

function isResearchBrief(value: unknown): value is VideoResearchBrief {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.topic === 'string' &&
    Array.isArray(record.findings) &&
    record.findings.every((item) => typeof item === 'string') &&
    Array.isArray(record.citations) &&
    typeof record.createdAt === 'string'
  );
}

function normalizeFacts(
  facts: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!facts) return undefined;
  const entries = Object.entries(facts)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key && value)
    .slice(0, 30);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
