import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDelayedLoading } from '@/components/common/use-delayed-loading';

function Probe({ loading }: { loading: boolean }) {
  const visible = useDelayedLoading(loading);
  return <p>{visible ? 'shown' : 'hidden'}</p>;
}

describe('useDelayedLoading', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays hidden until the show delay elapses', () => {
    vi.useFakeTimers();
    render(<Probe loading />);

    expect(screen.getByText('hidden')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(screen.getByText('hidden')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('shown')).toBeInTheDocument();
  });

  it('never appears when loading ends before the delay', () => {
    vi.useFakeTimers();
    const view = render(<Probe loading />);

    act(() => {
      vi.advanceTimersByTime(119);
    });
    view.rerender(<Probe loading={false} />);
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText('hidden')).toBeInTheDocument();
  });

  it('stays visible for the minimum time after loading ends', () => {
    vi.useFakeTimers();
    const view = render(<Probe loading />);

    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.getByText('shown')).toBeInTheDocument();

    view.rerender(<Probe loading={false} />);
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(screen.getByText('shown')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('hidden')).toBeInTheDocument();
  });
});
