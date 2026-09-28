import { startTransition, useState } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteViewTransition } from '@/app/RouteViewTransition';

/**
 * `<ViewTransition>` needs `document.startViewTransition`, which jsdom does
 * not implement. React is documented to skip the animation and commit
 * normally when the browser API is unavailable, so these tests exercise
 * that this component never crashes and always renders whichever child it
 * is given — the persistent-Outlet "swap the page content" case this
 * wrapper exists for.
 */
function Page({ label }: { label: string }) {
  return <div data-testid="page">{label}</div>;
}

function Harness() {
  const [label, setLabel] = useState('home');
  return (
    <div>
      <button onClick={() => startTransition(() => setLabel('library'))}>
        navigate
      </button>
      <RouteViewTransition>
        <Page label={label} />
      </RouteViewTransition>
    </div>
  );
}

describe('RouteViewTransition', () => {
  it('renders its initial child without crashing', () => {
    render(<Harness />);
    expect(screen.getByTestId('page')).toHaveTextContent('home');
  });

  it('swaps to the new child after a startTransition-driven route change', async () => {
    render(<Harness />);
    screen.getByText('navigate').click();
    expect(await screen.findByText('library')).toBeInTheDocument();
  });

  it('renders a plain, non-transitioned update the same way', () => {
    // Regression guard: a child change that is NOT wrapped in
    // startTransition (e.g. a stray re-render) must still render correctly
    // — ViewTransition must never swallow content when no transition is
    // active.
    const { rerender } = render(
      <RouteViewTransition>
        <Page label="a" />
      </RouteViewTransition>,
    );
    rerender(
      <RouteViewTransition>
        <Page label="b" />
      </RouteViewTransition>,
    );
    expect(screen.getByTestId('page')).toHaveTextContent('b');
  });
});
