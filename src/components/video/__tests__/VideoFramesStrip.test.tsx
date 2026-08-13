import type { ContentGraph } from '@neumar/video-ir';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders as render } from '../../../__tests__/helpers/render-with-providers';
import { VideoFramesStrip } from '../VideoFramesStrip';

function graph(): ContentGraph {
  return {
    schemaVersion: 1,
    intent: 'explainer',
    nodes: [
      { id: 'a', kind: 'text', text: 'Alpha' },
      { id: 'b', kind: 'text', text: 'Bravo' },
      { id: 'c', kind: 'text', text: 'Charlie' },
    ],
    edges: [],
  };
}

function dataGraph(): ContentGraph {
  return {
    schemaVersion: 1,
    intent: 'data-viz',
    nodes: [
      {
        id: 'metrics',
        kind: 'data',
        data: { revenue: 12, retention: 0.9 },
      },
    ],
    edges: [],
  };
}

describe('VideoFramesStrip', () => {
  it('renders an empty state when there is no graph', () => {
    render(<VideoFramesStrip graph={null} onSave={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders frames in topological order with their text', () => {
    render(<VideoFramesStrip graph={graph()} onSave={vi.fn()} />);
    expect(screen.getByTestId('frame-a')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('persists an inline text edit on the edited node', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<VideoFramesStrip graph={graph()} onSave={onSave} />);

    const frameA = screen.getByTestId('frame-a');
    fireEvent.click(frameA.querySelector('[aria-label="Edit frame text"]')!);
    const textarea = screen.getByLabelText('frame text');
    fireEvent.change(textarea, { target: { value: 'Alpha edited' } });
    fireEvent.click(screen.getByLabelText('Save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const next = onSave.mock.calls[0][0] as ContentGraph;
    const nodeA = next.nodes.find((n) => n.id === 'a');
    expect(nodeA?.kind === 'text' && nodeA.text).toBe('Alpha edited');
    // Siblings untouched.
    const nodeB = next.nodes.find((n) => n.id === 'b');
    expect(nodeB?.kind === 'text' && nodeB.text).toBe('Bravo');
  });

  it('reorders frames by swapping adjacent nodes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<VideoFramesStrip graph={graph()} onSave={onSave} />);

    const frameA = screen.getByTestId('frame-a');
    fireEvent.click(frameA.querySelector('[aria-label="Move frame later"]')!);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const next = onSave.mock.calls[0][0] as ContentGraph;
    expect(next.nodes.map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('fires onSelect when a frame label is clicked', () => {
    const onSelect = vi.fn();
    render(
      <VideoFramesStrip graph={graph()} onSave={vi.fn()} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('Frame 2'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('toggles native Remotion enhancement on data frames', async () => {
    const onSetNativeEnhancement = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoFramesStrip
        graph={dataGraph()}
        onSave={vi.fn()}
        onSetNativeEnhancement={onSetNativeEnhancement}
      />,
    );

    fireEvent.click(screen.getByLabelText('Enhance with Remotion'));

    await waitFor(() =>
      expect(onSetNativeEnhancement).toHaveBeenCalledWith('metrics', true),
    );
  });

  it('shows native state and reverts an enhanced data frame', async () => {
    const onSetNativeEnhancement = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoFramesStrip
        graph={dataGraph()}
        onSave={vi.fn()}
        nativeEnhancedNodeIds={['metrics']}
        onSetNativeEnhancement={onSetNativeEnhancement}
      />,
    );

    expect(screen.getByText('Native')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Revert to HTML frame'));

    await waitFor(() =>
      expect(onSetNativeEnhancement).toHaveBeenCalledWith('metrics', false),
    );
  });
});
