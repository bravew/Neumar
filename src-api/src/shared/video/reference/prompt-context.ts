import type { VideoProject } from '../types';
import { getReferenceReading } from './reading';
import { readReferenceRun } from './run';

/**
 * Live Analyze-video state folded into the chat agent's system prompt.
 *
 * The Analyze panel owns the run, but its `read` and `extract` steps are
 * agent-owned: the pipeline parks them and this agent finishes them. Without
 * this block the chat has no idea a run is waiting on it, which is what made
 * the panel and the conversation look unrelated.
 */
export interface ReferenceStudyPromptContext {
  referenceId: string;
  label: string;
  durationMs: number;
  focus?: string;
  run?: {
    status: string;
    steps: Array<{
      id: string;
      owner: 'system' | 'agent';
      status: string;
      note?: string;
    }>;
  };
  artifacts: {
    analysis: boolean;
    timeline: boolean;
    evidenceCount: number;
    analysisStale: boolean;
  };
  /**
   * The reading itself, so the chat can answer questions about the results the
   * user has open instead of re-reading artifacts through tool calls.
   */
  reading?: {
    intent?: string;
    sections: Array<{
      id: string;
      phase: string;
      startMs: number;
      endMs: number;
      confidence: number;
      effect?: string;
    }>;
    openQuestions: string[];
  };
}

/** Caps on the reading folded into the prompt, so a long study stays bounded. */
const MAX_SECTIONS = 20;
const MAX_OPEN_QUESTIONS = 10;

export async function buildReferenceStudyContext(
  project: VideoProject,
  referenceId: string,
): Promise<ReferenceStudyPromptContext | undefined> {
  const reference = project.videoReferences?.find(
    (candidate) => candidate.id === referenceId,
  );
  if (!reference) return undefined;
  const [run, reading] = await Promise.all([
    readReferenceRun(project.id, referenceId),
    getReferenceReading(project.id, referenceId),
  ]);
  return {
    referenceId,
    label: reference.label,
    durationMs: reference.durationMs,
    ...(run?.focus?.text ? { focus: run.focus.text } : {}),
    ...(run
      ? {
          run: {
            status: run.status,
            steps: run.steps.map((step) => ({
              id: step.id,
              owner: step.owner,
              status: step.status,
              ...(step.note ? { note: step.note } : {}),
            })),
          },
        }
      : {}),
    artifacts: {
      analysis: reading.analysis !== null,
      timeline: reading.timeline !== null,
      evidenceCount: reading.evidence.length,
      analysisStale: reading.analysis?.stale === true,
    },
    ...(reading.analysis || reading.timeline
      ? {
          reading: {
            ...(reading.analysis?.data.intent
              ? { intent: reading.analysis.data.intent }
              : {}),
            sections: (reading.timeline?.data.sections ?? [])
              .slice(0, MAX_SECTIONS)
              .map((section) => ({
                id: section.id,
                phase: section.phase,
                startMs: section.startMs,
                endMs: section.endMs,
                confidence: section.confidence,
                ...(section.effect ? { effect: section.effect } : {}),
              })),
            openQuestions: (reading.analysis?.data.openQuestions ?? [])
              .slice(0, MAX_OPEN_QUESTIONS)
              .map((item) => item.question),
          },
        }
      : {}),
  };
}
