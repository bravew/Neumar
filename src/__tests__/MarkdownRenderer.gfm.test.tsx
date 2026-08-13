import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownArtifact } from '@/components/artifacts/live/MarkdownArtifact';

import { renderWithProviders } from './helpers/render-with-providers';

describe('MarkdownArtifact GFM tables', () => {
  it('renders pipe tables with alignment markers and inline code', async () => {
    renderWithProviders(
      <MarkdownArtifact
        source={[
          '- Before table',
          '',
          '| Name | Count |',
          '| :--- | ---: |',
          '| `alpha` | 2 |',
        ].join('\n')}
      />,
    );

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    expect(screen.getByText('alpha')).toBeVisible();
  });

  it('renders header-only tables', async () => {
    renderWithProviders(<MarkdownArtifact source={'| Empty |\n| --- |\n'} />);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Empty' })).toBeVisible();
  });
});
