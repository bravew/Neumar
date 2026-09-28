import { startTransition, useState } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RightSidebarPanelTransition } from '@/components/task/RightSidebarPanelTransition';

/**
 * Mirrors the `isRightSidebarVisible` toggle in `TaskDetailV2.tsx`: the
 * panel mounts/unmounts based on boolean state flipped inside
 * `startTransition`. jsdom has no `document.startViewTransition`, so this
 * only verifies the mount/unmount behavior itself is preserved — the
 * animation is a browser-only concern, degrading to a plain commit per
 * React's docs when the API is unavailable.
 */
function Harness() {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <button onClick={() => startTransition(() => setVisible((v) => !v))}>
        toggle
      </button>
      {visible && (
        <RightSidebarPanelTransition>
          <div data-testid="panel">sidebar content</div>
        </RightSidebarPanelTransition>
      )}
    </div>
  );
}

describe('RightSidebarPanelTransition', () => {
  it('is not rendered until the panel is shown', () => {
    render(<Harness />);
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });

  it('mounts the panel after a startTransition-driven toggle', async () => {
    render(<Harness />);
    screen.getByText('toggle').click();
    expect(await screen.findByTestId('panel')).toBeInTheDocument();
  });

  it('unmounts the panel when toggled back off', async () => {
    render(<Harness />);
    const toggle = screen.getByText('toggle');
    toggle.click();
    await screen.findByTestId('panel');
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });
});
