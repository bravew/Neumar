import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HtmlSandbox } from '@/components/artifacts/live/HtmlSandbox';

import { renderWithProviders } from './helpers/render-with-providers';

describe('HtmlSandbox downloads', () => {
  it('allows downloads without granting same-origin access', () => {
    renderWithProviders(
      <HtmlSandbox
        html='<a download="report.txt" href="data:text/plain,hi">Download</a>'
        identity="download-test"
      />,
    );

    const iframe = screen.getByTitle('html artifact');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-downloads');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });
});
