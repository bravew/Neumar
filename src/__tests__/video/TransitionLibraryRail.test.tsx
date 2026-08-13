import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasTransitionDragType,
  readTransitionDrag,
  TRANSITION_DRAG_MIME,
  writeTransitionDrag,
} from '@/components/video/transitions/transitionDragPayload';
import { TransitionLibraryRail } from '@/components/video/transitions/TransitionLibraryRail';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('TransitionLibrary', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (contextId: string) => {
        if (contextId !== '2d') return null;
        return canvasContextStub() as unknown as CanvasRenderingContext2D;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('writes and reads transition drag payloads', () => {
    const dataTransfer = new FakeDataTransfer();

    writeTransitionDrag(dataTransfer.asDataTransfer(), {
      type: 'video-transition',
      kind: 'fade',
      durationMs: 500,
    });

    expect(hasTransitionDragType(dataTransfer.asDataTransfer())).toBe(true);
    expect(readTransitionDrag(dataTransfer.asDataTransfer())).toEqual({
      type: 'video-transition',
      kind: 'fade',
      durationMs: 500,
    });
    expect(dataTransfer.getData('text/plain')).toBe('transition:fade');
  });

  it('renders searchable transition tiles and starts drags', () => {
    renderWithProviders(<TransitionLibraryRail />);

    expect(screen.getByText('Transitions')).toBeInTheDocument();
    expect(screen.getByText('Fade')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search transitions'), {
      target: { value: 'cube' },
    });

    expect(screen.getByText('Cube')).toBeInTheDocument();
    expect(screen.queryByText('Fade')).not.toBeInTheDocument();

    const dataTransfer = new FakeDataTransfer();
    fireEvent.dragStart(screen.getByRole('button', { name: /drag cube/i }), {
      dataTransfer: dataTransfer.asDataTransfer(),
    });

    expect(dataTransfer.types).toContain(TRANSITION_DRAG_MIME);
    expect(readTransitionDrag(dataTransfer.asDataTransfer())).toMatchObject({
      type: 'video-transition',
      kind: 'cube',
      durationMs: 600,
    });
  });

  it('does not label upgraded WebGL presets as approximate previews', () => {
    renderWithProviders(<TransitionLibraryRail />);

    const search = screen.getByPlaceholderText('Search transitions');
    for (const label of ['Iris', 'Cover', 'Reveal', 'Flip', 'Cube']) {
      fireEvent.change(search, { target: { value: label } });

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText('Approx preview')).not.toBeInTheDocument();
    }
  });
});

class FakeDataTransfer {
  effectAllowed = 'uninitialized';
  readonly types: string[] = [];
  private readonly data = new Map<string, string>();

  asDataTransfer(): DataTransfer {
    return this as unknown as DataTransfer;
  }

  getData(type: string): string {
    return this.data.get(type) ?? '';
  }

  setData(type: string, value: string): void {
    if (!this.types.includes(type)) this.types.push(type);
    this.data.set(type, value);
  }
}

function canvasContextStub() {
  const gradient = { addColorStop: vi.fn() };
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  };
}
