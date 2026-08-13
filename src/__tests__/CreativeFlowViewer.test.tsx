import { StrictMode } from 'react';

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreativeFlowViewer } from '@/components/creative/CreativeFlowViewer';
import {
  clearCreativeDebugCounters,
  readCreativeDebugCounters,
} from '@/shared/creative-workflow/debug-counters';

import { installLocalStorageMock } from './helpers/local-storage';
import { renderWithProviders } from './helpers/render-with-providers';

describe('CreativeFlowViewer', () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => clearCreativeDebugCounters());

  it('counts flow opens and recovery actions locally', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    renderWithProviders(
      <StrictMode>
        <CreativeFlowViewer
          nodes={[
            {
              id: 'brief',
              kind: 'brief',
              label: 'Brief',
              status: 'ready',
            },
            {
              id: 'job',
              kind: 'job',
              label: 'Render job',
              status: 'failed',
            },
          ]}
          edges={[{ id: 'edge-1', from: 'brief', to: 'job' }]}
          ledgerItems={[
            {
              id: 'job-1',
              title: 'Render failed',
              status: 'failed',
              onRetry,
            },
          ]}
        />
      </StrictMode>,
    );

    expect(
      readCreativeDebugCounters().events['flow.viewer.opened']?.count,
    ).toBe(1);

    await user.click(
      screen.getByRole('button', { name: 'Retry: Render failed' }),
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(
      readCreativeDebugCounters().events['recovery.action.used']?.count,
    ).toBe(1);
  });
});
