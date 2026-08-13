import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownProse } from '@/components/task/TaskV2MarkdownProse';

import { renderWithProviders } from './helpers/render-with-providers';

describe('MarkdownProse code cards', () => {
  it('renders fenced code as a framed card with metadata and copy', async () => {
    const user = userEvent.setup();
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      renderWithProviders(
        <MarkdownProse
          animated={false}
          content={[
            '```tsx title="src/App.tsx"',
            'export function App() {',
            '  return <main>Hello</main>;',
            '}',
            '```',
          ].join('\n')}
        />,
      );

      const card = await screen.findByTestId('assistant-code-card');
      expect(card).toHaveTextContent('src/App.tsx');
      expect(card).toHaveTextContent('tsx');

      await user.click(screen.getByRole('button', { name: /copy code/i }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(
          expect.stringContaining('export function App()'),
        );
      });
      expect(
        screen.getByRole('button', { name: /copied/i }),
      ).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('renders partial streaming code fences as framed cards', async () => {
    renderWithProviders(
      <MarkdownProse
        animated
        content={'```ts title="src/live.ts"\nexport const live = true;'}
      />,
    );

    const card = await screen.findByTestId('assistant-code-card');
    expect(card).toHaveTextContent('src/live.ts');
    expect(card).toHaveTextContent('export const live = true;');
  });
});
