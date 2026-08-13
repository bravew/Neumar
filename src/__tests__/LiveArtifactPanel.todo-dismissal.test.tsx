import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveArtifactPanel } from '@/components/artifacts/live/LiveArtifactPanel';
import { TODO_ARTIFACT_DISMISSAL_STORAGE_KEY } from '@/components/artifacts/live/todo-dismissal';
import type { ArtifactMap } from '@/shared/artifacts/reducer';
import type { ArtifactSnapshot } from '@/shared/types/artifact';

import { renderWithProviders } from './helpers/render-with-providers';

const liveArtifactMocks = vi.hoisted(() => ({
  artifacts: new Map<string, ArtifactSnapshot>() as ArtifactMap,
}));

vi.mock('@/shared/hooks/useLiveArtifacts', () => ({
  useLiveArtifacts: () => liveArtifactMocks.artifacts,
}));

describe('LiveArtifactPanel todo dismissal', () => {
  beforeEach(() => {
    const storage = createStorageMock();
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
  });

  afterEach(() => {
    liveArtifactMocks.artifacts = new Map();
    vi.unstubAllGlobals();
  });

  it('persists dismissed todo snapshots and re-shows updated snapshots', () => {
    liveArtifactMocks.artifacts = new Map([['todo_1', todoSnapshot(1)]]);

    const rendered = renderWithProviders(
      <LiveArtifactPanel taskId="task_1" isRunning={false} />,
    );

    expect(screen.getByText('Draft the brief')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Dismiss'));

    expect(screen.queryByText('Draft the brief')).not.toBeInTheDocument();
    expect(
      JSON.parse(
        window.localStorage.getItem(TODO_ARTIFACT_DISMISSAL_STORAGE_KEY) ??
          '[]',
      ),
    ).toHaveLength(1);

    rendered.unmount();

    const remounted = renderWithProviders(
      <LiveArtifactPanel taskId="task_1" isRunning={false} />,
    );

    expect(screen.queryByText('Draft the brief')).not.toBeInTheDocument();

    liveArtifactMocks.artifacts = new Map([['todo_1', todoSnapshot(2)]]);
    remounted.rerender(<LiveArtifactPanel taskId="task_1" isRunning={false} />);

    expect(screen.getByText('Review updated copy')).toBeInTheDocument();
  });
});

function todoSnapshot(version: number): ArtifactSnapshot {
  const text = version === 1 ? 'Draft the brief' : 'Review updated copy';
  return {
    id: 'todo_1',
    taskId: 'task_1',
    messageId: 'message_1',
    kind: 'todo-list',
    title: 'Plan',
    version,
    createdAt: 1,
    updatedAt: version,
    content: JSON.stringify({
      items: [{ id: `item_${version}`, text, state: 'pending' }],
    }),
  };
}

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
