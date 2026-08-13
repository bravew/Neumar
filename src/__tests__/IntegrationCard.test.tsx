import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IntegrationCard } from '@/components/auth/IntegrationCard';
import type { OAuthConnection } from '@/shared/hooks/useAuth';

import { renderWithProviders } from './helpers/render-with-providers';

describe('IntegrationCard', () => {
  it('groups connection details and scopes behind the details control', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <IntegrationCard
        provider="google"
        connection={connectionFixture}
        available={true}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /open google/i }));

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getAllByText('reader@example.com')).toHaveLength(2);
    expect(screen.getByText('Scopes')).toBeInTheDocument();
    expect(screen.getByText('drive.readonly')).toBeInTheDocument();
    expect(screen.getByText('calendar.readonly')).toBeInTheDocument();
  });
});

const connectionFixture = {
  id: 'conn_google',
  provider: 'google',
  accountEmail: 'reader@example.com',
  displayName: 'Reader',
  avatarUrl: '',
  scopes: ['drive.readonly', 'calendar.readonly'],
  status: 'active',
  connectedAt: '2026-05-24T12:00:00.000Z',
  expiresAt: null,
  updatedAt: '2026-05-24T12:00:00.000Z',
} satisfies OAuthConnection;
