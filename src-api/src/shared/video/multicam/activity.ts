export const MULTICAM_ACTIVITY_SCHEMA_ID = 'neuma.video.multicam-activity.v1';

/**
 * Speech probability for one participant over one analysis window, on the
 * reference camera's clock.
 */
export interface ActivityFrame {
  atReferenceMs: number;
  /** Raw VAD probability, before any bleed correction. Always preserved. */
  raw: number;
  /**
   * Probability after bleed correction, when calibration was confident enough
   * to apply it. Equal to `raw` otherwise.
   */
  corrected: number;
}

export interface ParticipantActivity {
  participantId: string;
  frames: ActivityFrame[];
  /**
   * How much of this participant's microphone is another participant leaking
   * in, per source participant. 0..1.
   */
  bleed: Record<string, number>;
  /** 0..1 confidence in the bleed estimate above. */
  bleedConfidence: number;
  bleedCorrectionApplied: boolean;
}

export interface ActivityMap {
  schema: typeof MULTICAM_ACTIVITY_SCHEMA_ID;
  manifestId: string;
  windowMs: number;
  participants: ParticipantActivity[];
  sourceFingerprint: string;
}

/**
 * Below this, a bleed estimate is a guess, and subtracting a guess from a real
 * signal is how a quiet speaker gets cut out of their own shot. Raw
 * probabilities are always kept either way, so a reviewer can see what the
 * detector actually heard.
 */
export const BLEED_CORRECTION_CONFIDENCE_THRESHOLD = 0.6;

export interface SpeechRange {
  participantId: string;
  startMs: number;
  endMs: number;
  meanProbability: number;
}

/**
 * Estimate how much of each microphone is another participant leaking in.
 *
 * Uses only windows where exactly one participant is clearly speaking: in those
 * windows, anything the other microphones register is by definition bleed. When
 * a recording has no such windows — everybody always talks at once — confidence
 * comes back low and correction is skipped rather than guessed at.
 */
export function estimateBleed(
  participants: Array<{ participantId: string; frames: ActivityFrame[] }>,
  options: { speakingThreshold?: number; quietThreshold?: number } = {},
): Record<string, { bleed: Record<string, number>; confidence: number }> {
  const speaking = options.speakingThreshold ?? 0.7;
  const quiet = options.quietThreshold ?? 0.3;
  const frameCount = participants[0]?.frames.length ?? 0;

  const totals: Record<string, Record<string, { sum: number; n: number }>> = {};
  for (const participant of participants) {
    totals[participant.participantId] = {};
  }

  let soloWindows = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const loud = participants.filter(
      (participant) => (participant.frames[index]?.raw ?? 0) >= speaking,
    );
    const others = participants.filter(
      (participant) => (participant.frames[index]?.raw ?? 0) < quiet,
    );
    if (loud.length !== 1 || others.length !== participants.length - 1) {
      continue;
    }
    soloWindows += 1;

    const source = loud[0]!;
    const sourceLevel = source.frames[index]?.raw ?? 0;
    for (const listener of others) {
      const bucket = (totals[listener.participantId] ??= {});
      const entry = (bucket[source.participantId] ??= { sum: 0, n: 0 });
      entry.sum +=
        (listener.frames[index]?.raw ?? 0) / Math.max(sourceLevel, 1e-6);
      entry.n += 1;
    }
  }

  // Confidence scales with how many clean solo windows the recording gave us,
  // saturating at 20 — past that, more windows do not make the estimate
  // meaningfully better.
  const confidence = Math.min(1, soloWindows / 20);

  const result: Record<
    string,
    { bleed: Record<string, number>; confidence: number }
  > = {};
  for (const participant of participants) {
    const bucket = totals[participant.participantId] ?? {};
    const bleed: Record<string, number> = {};
    for (const [sourceId, entry] of Object.entries(bucket)) {
      if (entry.n > 0) bleed[sourceId] = entry.sum / entry.n;
    }
    result[participant.participantId] = { bleed, confidence };
  }
  return result;
}

/**
 * Subtract estimated bleed from each participant's raw probabilities.
 *
 * Only runs when the calibration cleared the threshold. `raw` survives on every
 * frame regardless, so the correction is auditable and reversible.
 */
export function applyBleedCorrection(
  participants: Array<{ participantId: string; frames: ActivityFrame[] }>,
  estimates: Record<
    string,
    { bleed: Record<string, number>; confidence: number }
  >,
): ParticipantActivity[] {
  return participants.map((participant) => {
    const estimate = estimates[participant.participantId] ?? {
      bleed: {},
      confidence: 0,
    };
    const apply =
      estimate.confidence >= BLEED_CORRECTION_CONFIDENCE_THRESHOLD &&
      Object.keys(estimate.bleed).length > 0;

    const frames = participant.frames.map((frame, index) => {
      if (!apply) return { ...frame, corrected: frame.raw };
      let corrected = frame.raw;
      for (const [sourceId, ratio] of Object.entries(estimate.bleed)) {
        const source = participants.find(
          (candidate) => candidate.participantId === sourceId,
        );
        corrected -= ratio * (source?.frames[index]?.raw ?? 0);
      }
      return { ...frame, corrected: clamp01(corrected) };
    });

    return {
      participantId: participant.participantId,
      frames,
      bleed: estimate.bleed,
      bleedConfidence: estimate.confidence,
      bleedCorrectionApplied: apply,
    };
  });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Turn per-window probabilities into speech ranges.
 *
 * Hysteresis on purpose: a single window dipping below the threshold mid-word
 * should not end a range and hand the planner a cut. Speech starts at the high
 * threshold and continues until it falls below the low one.
 */
export function toSpeechRanges(
  activity: ParticipantActivity,
  options: {
    windowMs: number;
    startThreshold?: number;
    endThreshold?: number;
    minSpeechMs?: number;
  },
): SpeechRange[] {
  const start = options.startThreshold ?? 0.6;
  const end = options.endThreshold ?? 0.35;
  const minSpeechMs = options.minSpeechMs ?? 0;

  const ranges: SpeechRange[] = [];
  let open: { startMs: number; sum: number; n: number } | null = null;

  for (const frame of activity.frames) {
    const value = frame.corrected;
    if (!open && value >= start) {
      open = { startMs: frame.atReferenceMs, sum: value, n: 1 };
      continue;
    }
    if (!open) continue;

    if (value >= end) {
      open.sum += value;
      open.n += 1;
      continue;
    }

    pushRange(
      ranges,
      activity.participantId,
      open,
      frame.atReferenceMs,
      minSpeechMs,
    );
    open = null;
  }

  if (open) {
    const lastFrame = activity.frames.at(-1);
    pushRange(
      ranges,
      activity.participantId,
      open,
      (lastFrame?.atReferenceMs ?? open.startMs) + options.windowMs,
      minSpeechMs,
    );
  }
  return ranges;
}

function pushRange(
  ranges: SpeechRange[],
  participantId: string,
  open: { startMs: number; sum: number; n: number },
  endMs: number,
  minSpeechMs: number,
): void {
  if (endMs - open.startMs < minSpeechMs) return;
  ranges.push({
    participantId,
    startMs: open.startMs,
    endMs,
    meanProbability: open.sum / open.n,
  });
}
