import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HtmlVideoPanel } from '@/components/video/html-video/HtmlVideoPanel';

import { renderWithProviders } from '../helpers/render-with-providers';

// Slice K — the panel is the gate-#1 reachability surface. Hooks are mocked so
// the test exercises the flag gating + composition, not the network.

const flagsMock = vi.fn();
vi.mock('@/shared/video/useVideoFlags', () => ({
  useVideoFlags: () => flagsMock(),
}));
vi.mock('@/shared/video/useHtmlGallery', () => ({
  useHtmlGallery: () => ({ templates: [], loading: false, error: null }),
}));
// Stable references — the real hook's `selection` is referentially stable
// between renders; returning a fresh object here would make the consumer's
// sync-effect (deps include selection.variables) re-render forever.
const STABLE_SELECTION = { templateId: null, variables: {} };
const stableHtmlSelection = {
  selection: STABLE_SELECTION,
  loading: false,
  error: null,
  setTemplate: vi.fn(),
  setVariables: vi.fn(),
};
vi.mock('@/shared/video/useHtmlSelection', () => ({
  useHtmlSelection: () => stableHtmlSelection,
}));
vi.mock('@/shared/video/useFormSpec', () => ({
  useFormSpec: () => ({ formSpec: null, loading: false, error: null }),
}));
vi.mock('@/shared/video/useTemplateSource', () => ({
  useTemplateSource: () => ({ html: null, loading: false, error: null }),
}));
vi.mock('@/shared/video/useContentGraph', () => ({
  useContentGraph: () => ({
    graph: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
    save: vi.fn(),
  }),
}));
vi.mock('@/shared/hooks/useVideoProject', () => ({
  useVideoProject: () => ({
    project: null,
    setFrameNativeEnhancement: vi.fn(),
  }),
}));

afterEach(() => vi.clearAllMocks());

describe('HtmlVideoPanel', () => {
  it('renders nothing while flags are loading', () => {
    flagsMock.mockReturnValue({ flags: {}, loading: true });
    const { container } = renderWithProviders(
      <HtmlVideoPanel projectId="p1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the kill switch disables the gallery', () => {
    flagsMock.mockReturnValue({
      flags: { 'video.templateGallery': false },
      loading: false,
    });
    const { container } = renderWithProviders(
      <HtmlVideoPanel projectId="p1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the authoring surface when flags are on', () => {
    flagsMock.mockReturnValue({ flags: {}, loading: false });
    renderWithProviders(<HtmlVideoPanel projectId="p1" />);
    // Panel title + the "pick a template" empty state are present.
    expect(screen.getByText('HTML video')).toBeInTheDocument();
    expect(
      screen.getByText('Pick a template to edit its variables.'),
    ).toBeInTheDocument();
  });
});
