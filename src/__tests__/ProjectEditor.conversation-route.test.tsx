import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import from the direct module, not the `@/components/layout` barrel, which
// pulls in react-pdf (DOMMatrix) and breaks under jsdom.
import { SidebarProvider } from '@/components/layout/sidebar-context';
import type { VideoProjectEditorActions } from '@/components/video/editorTypes';
import { ProjectEditor } from '@/components/video/ProjectEditor';
import type { VideoProject } from '@/shared/types/video';

import { renderWithProviders } from './helpers/render-with-providers';

vi.mock('@/components/creative/CreativeWorkflowHeader', () => ({
  CreativeWorkflowHeader: () => <div data-testid="creative-workflow-header" />,
}));

vi.mock('@/components/video/EditorLeftColumn', () => ({
  EditorLeftColumn: () => <div data-testid="video-editor-left" />,
}));

vi.mock('@/components/video/EditorRightColumn', () => ({
  EditorRightColumn: () => <div data-testid="video-editor-right" />,
}));

vi.mock('@/components/video/ProjectEditorCanvasPanel', () => ({
  ProjectEditorCanvasPanel: () => <div data-testid="video-editor-canvas" />,
}));

vi.mock('@/shared/hooks/useVideoProject', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/hooks/useVideoProject')
  >('@/shared/hooks/useVideoProject');
  return {
    ...actual,
    useVideoProjectPolling: vi.fn(),
  };
});

describe('ProjectEditor conversation route', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
  });

  it('hides the shared workflow header on the default conversation route', () => {
    renderEditor('/video/video_fresh');

    expect(screen.queryByTestId('creative-workflow-header')).toBeNull();
    expect(screen.getByTestId('video-editor-left')).toBeVisible();
    expect(screen.getByTestId('video-editor-canvas')).toBeVisible();
  });

  it('shows the shared workflow header on explicit production steps', () => {
    renderEditor('/video/video_fresh?step=brief');

    expect(screen.getByTestId('creative-workflow-header')).toBeVisible();
  });
});

function renderEditor(route: string) {
  renderWithProviders(
    <SidebarProvider>
      <ProjectEditor
        project={videoProject()}
        actions={editorActions()}
        setProject={vi.fn()}
        onBack={vi.fn()}
      />
    </SidebarProvider>,
    { initialEntries: [route] },
  );
}

function videoProject(): VideoProject {
  const now = '2026-06-27T00:00:00.000Z';
  return {
    id: 'video_fresh',
    name: 'Fresh video',
    template: 'slideshow',
    prompt: 'Make a product video',
    assets: [],
    createdAt: now,
    updatedAt: now,
  };
}

function editorActions(): VideoProjectEditorActions {
  return {
    regenerateScene: vi.fn(),
  } as unknown as VideoProjectEditorActions;
}
