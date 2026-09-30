import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AsyncList } from '@/components/common/async-list';

function Probe({
  status,
  empty = false,
}: {
  status: 'loading' | 'ready' | 'error';
  empty?: boolean;
}) {
  return (
    <AsyncList
      status={status}
      empty={empty}
      renderSkeleton={() => <p>skeleton</p>}
      renderEmpty={() => <p>empty</p>}
      renderError={() => <p>error</p>}
    >
      <p>items</p>
    </AsyncList>
  );
}

describe('AsyncList', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render the empty state while loading', () => {
    vi.useFakeTimers();
    render(<Probe status="loading" empty />);

    expect(screen.queryByText('empty')).not.toBeInTheDocument();
    expect(screen.queryByText('items')).not.toBeInTheDocument();
    expect(screen.getByTestId('async-list-pending')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getByText('skeleton')).toBeInTheDocument();
    expect(screen.queryByText('empty')).not.toBeInTheDocument();
  });

  it('renders the empty state only when ready and empty', () => {
    render(<Probe status="ready" empty />);

    expect(screen.getByText('empty')).toBeInTheDocument();
    expect(screen.queryByText('skeleton')).not.toBeInTheDocument();
    expect(screen.queryByText('items')).not.toBeInTheDocument();
  });

  it('renders children when ready and not empty', () => {
    render(<Probe status="ready" />);

    expect(screen.getByText('items')).toBeInTheDocument();
  });

  it('renders the error state instead of an empty list', () => {
    render(<Probe status="error" empty />);

    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.queryByText('empty')).not.toBeInTheDocument();
  });
});
