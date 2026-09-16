import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  writeReferenceAnalysis,
  writeReferenceTimeline,
} from '@/shared/video/reference/reading';
import {
  ensureReferenceDir,
  readReferenceEnvelope,
  writeReferenceEnvelope,
} from '@/shared/video/reference/store';
import { createProject, updateProjectDocument } from '@/shared/video/store';
import type {
  EvidenceItem,
  ReferenceAnalysis,
  ReferenceTimelineArtifact,
  VideoReference,
} from '@/shared/video/types';
import { REFERENCE_READING_PROMPT_VERSION } from '@/shared/video/types';

const EVIDENCE: EvidenceItem = {
  id: 'ev-1',
  kind: 'grid',
  name: 'coarse',
  range: { startMs: 0, endMs: 3000 },
  sampledAtMs: [0, 1000, 2000],
  paths: ['references/ref-read1/evidence/grid.png'],
  labels: { time: true, words: false },
};

const ANALYSIS: ReferenceAnalysis = {
  intent: 'Teach a workflow.',
  arc: 'Hook, demo, payoff.',
  thesis: 'Captions carry the argument.',
  systems: [
    {
      id: 'sys-caption',
      role: 'caption',
      content: 'On-screen titles',
      appearance: 'White sans-serif',
      spatial: 'Lower third',
      entry: 'Fades in with the hook',
      behavior: 'Updates per beat',
      persistence: 'Stays until payoff',
      exit: 'Cuts with the last line',
      function: 'Names the claim',
      occurrences: [{ startMs: 0, endMs: 2000 }],
      evidenceIds: ['ev-1'],
      confidence: 0.8,
    },
  ],
  openQuestions: [],
  observed: ['White captions sit over a dark bed.'],
  inferred: ['The captions are the thesis, not decoration.'],
  promptVersion: REFERENCE_READING_PROMPT_VERSION,
};

const TIMELINE: ReferenceTimelineArtifact = {
  sections: [
    {
      id: 'sec-1',
      startMs: 0,
      endMs: 2000,
      phase: 'The hook',
      anchor: 'first line',
      activeSystems: [{ systemId: 'sys-caption', note: 'names the claim' }],
      effect: 'Orients the viewer',
      evidenceIds: ['ev-1'],
      confidence: 0.7,
    },
  ],
  coverage: {
    totalMs: 3000,
    sampleCount: 3,
    maxGapMs: 1000,
    thinRanges: [],
  },
  promptVersion: REFERENCE_READING_PROMPT_VERSION,
};

describe('reference reading fingerprint', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-reading-fp-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('marks downstream timeline stale when promptVersion bumps', async () => {
    const project = await seedProject();
    const referenceId = 'ref-read1';
    await writeReferenceAnalysis(project.id, referenceId, ANALYSIS);
    await writeReferenceTimeline(project.id, referenceId, TIMELINE);

    const before = await readReferenceEnvelope(
      project.id,
      referenceId,
      'timeline',
    );
    expect(before?.stale).toBeUndefined();

    await writeReferenceAnalysis(project.id, referenceId, {
      ...ANALYSIS,
      promptVersion: 'reference-reading.v2',
    });

    const after = await readReferenceEnvelope(
      project.id,
      referenceId,
      'timeline',
    );
    expect(after).not.toBeNull();
    expect(after?.stale).toBe(true);
    expect(after?.data).toMatchObject({ sections: [{ id: 'sec-1' }] });
  });
});

async function seedProject() {
  const project = await createProject({
    name: 'Reading fingerprint',
    template: 'explainer',
  });
  const referenceId = 'ref-read1';
  const reference: VideoReference = {
    id: referenceId,
    label: 'clip',
    origin: 'upload',
    mediaPath: `references/${referenceId}/media/source.mp4`,
    contentHash: 'abc',
    durationMs: 3000,
    rights: { studyAcknowledged: true, reuseAcknowledged: false },
    artifactIds: [],
    createdAt: new Date().toISOString(),
  };
  await updateProjectDocument(project.id, (current) => ({
    ...current,
    videoReferences: [reference],
  }));
  await ensureReferenceDir(project.id, referenceId);
  await writeReferenceEnvelope(project.id, {
    kind: 'evidence',
    referenceId,
    sourceFingerprint: 'evidence-fp',
    derivedFrom: {},
    generatedAt: new Date().toISOString(),
    producer: 'test',
    data: [EVIDENCE],
  });
  return project;
}
