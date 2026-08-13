import { StrictMode } from 'react';

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaGenerationWorkspace } from '@/components/creative/MediaGenerationWorkspace';
import { MediaModelCards } from '@/components/design/MediaModelCards';
import type { VideoProjectEditorActions } from '@/components/video/editorTypes';
import { SceneAssetPlanInspector } from '@/components/video/SceneAssetPlanInspector';
import {
  VideoAgentAssetContextPills,
  type VideoAgentAssetContextItem,
} from '@/components/video/VideoAgentAssetContextPills';
import {
  clearCreativeDebugCounters,
  readCreativeDebugCounters,
} from '@/shared/creative-workflow/debug-counters';
import type { VideoProject, VideoStoryboardScene } from '@/shared/types/video';

import { installLocalStorageMock } from './helpers/local-storage';
import { renderWithProviders } from './helpers/render-with-providers';

describe('MediaGenerationWorkspace', () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => clearCreativeDebugCounters());

  it('renders prompt, capabilities, and removable references', async () => {
    const user = userEvent.setup();
    const onPromptChange = vi.fn();
    const onRemoveReference = vi.fn();

    renderWithProviders(
      <StrictMode>
        <MediaGenerationWorkspace
          surface="image"
          prompt="Make a product shot"
          onPromptChange={onPromptChange}
          capabilities={[
            { id: 'model', label: 'Model', value: 'seedream-5.0' },
          ]}
          references={[{ id: 'asset-1', name: 'frame.png' }]}
          onRemoveReference={onRemoveReference}
        />
      </StrictMode>,
    );

    expect(screen.getByTestId('media-generation-workspace')).toBeVisible();
    expect(screen.getByText('seedream-5.0')).toBeInTheDocument();
    expect(screen.getByText('frame.png')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Use a warmer background' },
    });
    await user.click(
      screen.getByRole('button', { name: /remove frame\.png/i }),
    );

    expect(onPromptChange).toHaveBeenCalledWith('Use a warmer background');
    expect(onRemoveReference).toHaveBeenCalledWith('asset-1');
    expect(
      readCreativeDebugCounters().events['generate.panel.opened']?.count,
    ).toBe(1);
  });
});

describe('MediaModelCards', () => {
  it('filters models by requested generation surface', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithProviders(
      <MediaModelCards surface="video" onChange={onChange} />,
    );

    await user.click(screen.getByRole('button', { name: /choose a model/i }));
    await user.type(screen.getByPlaceholderText(/search models/i), 'seedance');

    expect(await screen.findByText('seedance-2.0')).toBeVisible();
    expect(screen.queryByText('seedream-5.0')).toBeNull();

    await user.click(screen.getByText('seedance-2.0'));

    expect(onChange).toHaveBeenCalledWith('seedance-2.0');
  });
});

describe('SceneAssetPlanInspector', () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => clearCreativeDebugCounters());

  it('uses the shared workspace for video scene generation without a model selector', () => {
    const onChange = vi.fn();

    renderWithProviders(
      <SceneAssetPlanInspector
        project={videoProject()}
        scene={aiClipScene()}
        actions={videoActions()}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('media-generation-workspace')).toBeVisible();
    expect(screen.getByText('Reference image: frame.png')).toBeInTheDocument();
    expect(
      screen.getByText('Last-frame reference: frame.png'),
    ).toBeInTheDocument();
    expect(screen.getByText('seedance-2-0-fast')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /choose a model/i }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Asset prompt'), {
      target: { value: 'A wider dolly shot' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ai-clip',
        prompt: 'A wider dolly shot',
      }),
    );
  });

  it('keeps regenerate payload fields wired inside the shared workspace', async () => {
    const user = userEvent.setup();
    const regenerateScene = vi.fn(async () => null);
    const actions = videoActions({ regenerateScene });

    renderWithProviders(
      <SceneAssetPlanInspector
        project={videoProject()}
        scene={aiClipScene()}
        actions={actions}
        onChange={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('checkbox', {
        name: /reference images will be uploaded/i,
      }),
    );
    await user.click(
      screen.getByRole('button', { name: /regenerate this scene/i }),
    );

    expect(regenerateScene).toHaveBeenCalledWith('scene-1', {
      prompt: 'Product motion shot',
      provider: 'seedance-2-0-fast',
      durationMs: 4200,
      refImageAssetId: 'asset-1',
      refImageTailAssetId: 'asset-1',
      seed: 1234,
      confirmReferenceUpload: true,
    });
    expect(
      readCreativeDebugCounters().events['generation.submitted']?.count,
    ).toBe(1);
  });

  it('clears clip first-frame and tail references through the reference selects', () => {
    const onChange = vi.fn();

    renderWithProviders(
      <SceneAssetPlanInspector
        project={videoProject()}
        scene={aiClipScene()}
        actions={videoActions()}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Reference image'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Last-frame reference'), {
      target: { value: '' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ai-clip',
        refImageId: undefined,
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ai-clip',
        refImageTailId: undefined,
      }),
    );
  });
});

describe('VideoAgentAssetContext', () => {
  it('keeps selected reference assets removable from the composer', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const assets: VideoAgentAssetContextItem[] = [
      { id: 'asset-1', name: 'frame.png', summary: '1920x1080' },
    ];

    renderWithProviders(
      <VideoAgentAssetContextPills
        assets={assets}
        assetContextLabel="Ref"
        removeAssetContextLabel="Remove {name} from context"
        onRemoveAssetContext={onRemove}
      />,
    );

    expect(screen.getByText('frame.png')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /remove frame\.png from context/i }),
    );

    expect(onRemove).toHaveBeenCalledWith('asset-1');
  });
});

function videoProject(): VideoProject {
  const now = '2026-06-21T00:00:00.000Z';
  return {
    schemaVersion: 2,
    id: 'video-1',
    name: 'Generation project',
    template: 'custom',
    prompt: 'Make a reel',
    assets: [
      {
        id: 'asset-1',
        kind: 'image',
        source: 'user',
        path: 'catalog:asset-1',
        metadata: {
          durationMs: 0,
          width: 1920,
          height: 1080,
          fileSize: 512_000,
        },
        provenance: {
          provider: 'local',
          sourceDisplayName: 'frame.png',
        },
      },
    ],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    analysisArtifacts: [],
    scenes: [],
    history: { head: -1, entries: [] },
    render: { status: 'idle', updatedAt: now },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function aiClipScene(): VideoStoryboardScene {
  return {
    id: 'scene-1',
    durationMs: 4200,
    intent: 'Show the product in motion',
    assetPlan: {
      kind: 'ai-clip',
      prompt: 'Product motion shot',
      refImageId: 'asset-1',
      refImageTailId: 'asset-1',
      provider: 'seedance-2-0-fast',
      aspectRatio: '16:9',
      durationMs: 4200,
      seed: 1234,
    },
  };
}

function videoActions(
  overrides: Partial<VideoProjectEditorActions> = {},
): VideoProjectEditorActions {
  return {
    uploadReferenceImages: vi.fn(),
    materializeSceneAsset: vi.fn(),
    regenerateScene: vi.fn(),
    ...overrides,
  } as unknown as VideoProjectEditorActions;
}
