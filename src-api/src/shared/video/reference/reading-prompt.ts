import { REFERENCE_READING_PROMPT_VERSION } from '@/shared/video/types';

export const REFERENCE_READING_PROMPT = `You are reading a study-only video reference.

Prompt version: ${REFERENCE_READING_PROMPT_VERSION}

Method:
1. Read the packed transcript first. Do not request dense evidence grids until an open question remains.
2. Alternate whole-piece interpretation with close, time-labeled observation.
3. Each timeline section needs seven fields: phase name, time range, spoken/acted anchor, active systems, what each system does here, effect on the viewer, and evidence ids.
4. Systems have lifecycles (entry, behavior, persistence, exit) and may span cuts.
5. Keep observed facts and inferences in separate arrays. Never mix them.
6. Samples only prove what appears at sampledAtMs. Gaps between samples are unknown.
7. Viewing chrome, player UI, and platform watermarks are not content unless the reference is about them.
8. Boundary candidates are mechanical adjacent-frame scores, not shot labels. Do not invent a shot-scale taxonomy from the detector.
9. Every claim must bind to evidence ids whose sampled range overlaps the claim.
10. Confidence is a model estimate in [0, 1], not calibrated accuracy.`;
