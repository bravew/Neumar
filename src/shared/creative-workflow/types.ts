import type {
  CreativeAssetDescriptor,
  CreativeAssetRole,
  CreativeAssetMaterializationState,
} from '@/shared/assets/types';

export const CREATIVE_WORKFLOW_STEPS = [
  'intent',
  'assets',
  'plan',
  'generate',
  'review',
  'export',
] as const;

export type CreativeWorkflowStep = (typeof CREATIVE_WORKFLOW_STEPS)[number];

export type CreativeWorkflowStepStatus =
  | 'not-started'
  | 'ready'
  | 'active'
  | 'complete'
  | 'blocked'
  | 'failed';

export type CreativeWorkflowMode = 'design' | 'video';

export const CREATIVE_INTENTS = [
  'design',
  'video',
  'image',
  'audio',
  'assets',
  'template',
  'import',
] as const;

export type CreativeIntentId = (typeof CREATIVE_INTENTS)[number];

export type MediaGenerationSurface = 'image' | 'video' | 'audio' | 'edit';

export type CreativeWorkflowActionId =
  | 'describe-intent'
  | 'send-brief'
  | 'answer-questions'
  | 'stop-run'
  | 'wait-for-run'
  | 'add-assets'
  | 'create-plan'
  | 'generate-media'
  | 'review-output'
  | 'export-output'
  | 'recover-failure';

export interface CreativeWorkflowAction {
  id: CreativeWorkflowActionId;
  step: CreativeWorkflowStep;
  disabled?: boolean;
  reason?: string;
}

export interface CreativeWorkflowStepState {
  step: CreativeWorkflowStep;
  status: CreativeWorkflowStepStatus;
  sourceStep?: string;
  completedAt?: string;
  reason?: string;
}

export interface CreativeWorkflowAssetSummary {
  total: number;
  byRole: Partial<Record<CreativeAssetRole, number>>;
  byMaterialization: Partial<Record<CreativeAssetMaterializationState, number>>;
  generated: number;
  used: number;
}

export interface CreativeWorkflowState {
  mode: CreativeWorkflowMode;
  projectId: string;
  title: string;
  currentStep: CreativeWorkflowStep;
  steps: CreativeWorkflowStepState[];
  primaryAction: CreativeWorkflowAction;
  assetSummary: CreativeWorkflowAssetSummary;
  assets: CreativeAssetDescriptor[];
  source: {
    kind: 'design-project' | 'video-project';
    status?: string;
  };
  updatedAt?: string;
}
