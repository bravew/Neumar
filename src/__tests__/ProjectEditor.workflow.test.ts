import { describe, expect, it } from 'vitest';

import { videoWorkflowSelectionForStep } from '@/components/video/workflowSelection';
import type { CreativeWorkflowState } from '@/shared/creative-workflow';

describe('ProjectEditor workflow shell mapping', () => {
  it('maps workflow steps to editor steps and opens the assets rail for assets', () => {
    const workflow = workflowFixture();

    expect(videoWorkflowSelectionForStep('plan', workflow)).toEqual({
      editorStep: 'board',
      sideRailTab: undefined,
    });
    expect(videoWorkflowSelectionForStep('assets', workflow)).toEqual({
      editorStep: 'brief',
      sideRailTab: 'assets',
    });
  });
});

function workflowFixture(): CreativeWorkflowState {
  return {
    mode: 'video',
    projectId: 'video_1',
    title: 'Launch spot',
    currentStep: 'assets',
    steps: [
      { step: 'intent', status: 'complete', sourceStep: 'brief' },
      { step: 'assets', status: 'active', sourceStep: 'brief' },
      { step: 'plan', status: 'ready', sourceStep: 'board' },
      { step: 'generate', status: 'not-started', sourceStep: 'generate' },
      { step: 'review', status: 'not-started', sourceStep: 'preview' },
      { step: 'export', status: 'not-started', sourceStep: 'preview' },
    ],
    primaryAction: { id: 'add-assets', step: 'assets' },
    assetSummary: {
      total: 0,
      generated: 0,
      used: 0,
      byRole: {},
      byMaterialization: {},
    },
    assets: [],
    source: { kind: 'video-project', status: 'idle' },
  };
}
