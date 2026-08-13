import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProjectAssetsGroupedList } from '@/components/video/assets/ProjectAssetsGroupedList';
import { writeProjectAssetDrag } from '@/components/video/projectAssetDrag';
import { useAgentAssetContext } from '@/components/video/useAgentAssetContext';
import { useAgentProjectAssetDrop } from '@/components/video/useAgentProjectAssetDrop';
import type { VideoProject } from '@/shared/types/video';

import { renderWithProviders } from '../helpers/render-with-providers';

type ProjectAsset = VideoProject['assets'][number];

describe('ProjectAssetsGroupedList context selection', () => {
  it('marks selected project assets and toggles chat context', async () => {
    const user = userEvent.setup();
    const onToggleContext = vi.fn();
    const asset = projectAsset();

    renderWithProviders(
      <ProjectAssetsGroupedList
        project={projectWithAsset(asset)}
        newIds={new Set()}
        selectedContextAssetIds={[asset.id]}
        onPreview={vi.fn()}
        onDelete={vi.fn()}
        onToggleContext={onToggleContext}
      />,
    );

    const checkbox = screen.getByLabelText(
      'Remove beach-roll.mov from agent context',
    );

    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    expect(onToggleContext).toHaveBeenCalledWith(asset);
  });

  it('adds project assets to agent context without toggling selected assets off', () => {
    const asset = projectAsset();
    const onActivateAgent = vi.fn();
    const { result } = renderHook(() =>
      useAgentAssetContext({
        assets: [asset],
        onActivateAgent,
      }),
    );

    act(() => result.current.addAssetContext(asset.id));
    act(() => result.current.addAssetContext(asset.id));

    expect(result.current.assetContextIds).toEqual([asset.id]);
    expect(result.current.assetContextAssets).toEqual([asset]);
    expect(onActivateAgent).toHaveBeenCalledTimes(1);
  });

  it('adds a dragged project asset when it is dropped on the agent composer', () => {
    const asset = projectAsset();
    const onAddAssetContext = vi.fn();
    render(
      <ProjectAssetDropTarget
        assets={[asset]}
        onAddAssetContext={onAddAssetContext}
      />,
    );
    const dataTransfer = createDataTransfer();
    writeProjectAssetDrag(dataTransfer, {
      assetId: asset.id,
      kind: 'video',
      name: 'beach-roll.mov',
      durationMs: 4200,
    });

    const target = screen.getByTestId('project-asset-drop-target');
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(dataTransfer.dropEffect).toBe('copy');
    expect(onAddAssetContext).toHaveBeenCalledWith(asset.id);
  });
});

function ProjectAssetDropTarget({
  assets,
  onAddAssetContext,
}: {
  assets: VideoProject['assets'];
  onAddAssetContext: (assetId: string) => void;
}) {
  const dropHandlers = useAgentProjectAssetDrop({
    assets,
    onAddAssetContext,
  });
  return <div data-testid="project-asset-drop-target" {...dropHandlers} />;
}

function projectAsset(): ProjectAsset {
  return {
    id: 'asset-1',
    kind: 'video',
    source: 'user',
    path: 'videos/project-1/assets/beach-roll.mov',
    metadata: {
      durationMs: 4200,
      width: 1920,
      height: 1080,
      fileSize: 1_024_000,
    },
    provenance: {
      provider: 'local',
      sourceDisplayName: 'beach-roll.mov',
    },
  };
}

function projectWithAsset(asset: ProjectAsset): VideoProject {
  const now = '2026-06-14T00:00:00.000Z';
  return {
    schemaVersion: 2,
    id: 'project-1',
    name: 'Asset context project',
    template: 'custom',
    prompt: 'Use selected project assets',
    assets: [asset],
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

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
    get types() {
      return Array.from(data.keys());
    },
    getData: vi.fn((type: string) => data.get(type) ?? ''),
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value);
    }),
  } as unknown as DataTransfer;
}
