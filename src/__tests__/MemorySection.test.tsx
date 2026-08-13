import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  MemoryDetailPanel,
  type MemoryV2,
} from '@/components/settings/components/MemoryExplorerParts';

import { renderWithProviders } from './helpers/render-with-providers';

describe('Memory settings affordances', () => {
  it('keeps the history affordance keyboard reachable in the detail panel', async () => {
    const user = userEvent.setup();
    const onPin = vi.fn();
    renderWithProviders(
      <MemoryDetailPanel
        memory={memoryFixture()}
        onClose={vi.fn()}
        onPin={onPin}
      />,
    );

    const pin = screen.getByRole('button', { name: /^pin$/i });
    pin.focus();
    expect(pin).toHaveFocus();
    expect(pin).toHaveClass('memory-history-affordance');
    expect(pin.closest('.memory-detail-panel')).toBeTruthy();

    await user.keyboard('{Enter}');
    expect(onPin).toHaveBeenCalledWith('memory_1', false);
  });
});

function memoryFixture(): MemoryV2 {
  const now = new Date('2026-05-12T12:00:00.000Z').toISOString();
  return {
    id: 'memory_1',
    content: 'Use compact enterprise dashboard layouts.',
    category: 'preference',
    importance: 0.8,
    source: 'manual',
    memoryType: 'semantic',
    scopeType: 'global',
    scopeId: null,
    confidence: 0.9,
    decayRate: 0.01,
    lifecycleStatus: 'active',
    language: 'en-US',
    hasEmbedding: true,
    accessCount: 2,
    lastAccessedAt: now,
    createdAt: now,
    updatedAt: now,
    validFrom: null,
    validUntil: null,
    parentId: null,
    consolidatedFrom: null,
    metadata: null,
  };
}
