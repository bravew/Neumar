import type {
  CreativeWorkflowState,
  CreativeWorkflowStep,
} from '@/shared/creative-workflow';

import type { VideoEditorStep } from './editorTypes';
import { VIDEO_EDITOR_STEPS } from './editorTypes';
import type { SideRailTab } from './SideRail';

const VIDEO_WORKFLOW_STEP_TO_EDITOR_STEP = {
  intent: 'brief',
  assets: 'brief',
  plan: 'board',
  generate: 'generate',
  review: 'preview',
  export: 'preview',
} as const satisfies Record<CreativeWorkflowStep, VideoEditorStep>;

export function parseVideoEditorStep(
  value: string | null,
): VideoEditorStep | null {
  if (!value) return null;
  return VIDEO_EDITOR_STEPS.includes(value as VideoEditorStep)
    ? (value as VideoEditorStep)
    : null;
}

export function videoWorkflowSelectionForStep(
  step: CreativeWorkflowStep,
  workflow: CreativeWorkflowState,
): { editorStep: VideoEditorStep; sideRailTab?: SideRailTab } {
  const sourceStep = workflow.steps.find(
    (item) => item.step === step,
  )?.sourceStep;
  return {
    editorStep:
      parseVideoEditorStep(sourceStep ?? null) ??
      VIDEO_WORKFLOW_STEP_TO_EDITOR_STEP[step],
    sideRailTab: step === 'assets' ? 'assets' : undefined,
  };
}
