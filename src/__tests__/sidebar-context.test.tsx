import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  SidebarProvider,
  useSidebar,
} from '@/components/layout/sidebar-context';

describe('SidebarProvider', () => {
  it('opens the left sidebar by default', () => {
    render(
      <SidebarProvider>
        <SidebarStateProbe />
      </SidebarProvider>,
    );

    expect(screen.getByText('left-open')).toBeInTheDocument();
  });

  it('can start with the left sidebar in floating preview mode', () => {
    render(
      <SidebarProvider defaultLeftOpen={false}>
        <SidebarStateProbe />
      </SidebarProvider>,
    );

    expect(screen.getByText('left-closed')).toBeInTheDocument();
  });
});

function SidebarStateProbe() {
  const { leftOpen } = useSidebar();
  return <span>{leftOpen ? 'left-open' : 'left-closed'}</span>;
}
