import { useState } from 'react';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileWorkspace } from '@/components/design/FileWorkspace';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileWorkspace completion reload', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('refreshes the file list after completion and keeps the file the user selected', async () => {
    const user = userEvent.setup();
    const workspace = mockWorkspaceFetch();

    renderWithProviders(<ReloadHarness />);

    await user.click(
      await screen.findByRole('button', { name: 'Toggle file tree' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'artifacts/chosen.html' }),
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'Select artifacts/chosen.html' }),
    );
    await waitFor(() => expect(visibleHtmlPreview()).toContain('chosen.html'));
    expect(
      screen.getByRole('checkbox', { name: 'Select artifacts/chosen.html' }),
    ).toBeChecked();

    await user.click(
      screen.getByRole('button', { name: 'Complete design run' }),
    );

    // The completion read is still in flight. Refreshing must not replace
    // the file the user opened while the new list is on its way.
    expect(visibleHtmlPreview()).toContain('chosen.html');

    workspace.releaseCompletionList();
    await screen.findByRole('button', { name: 'artifacts/generated.html' });
    expect(visibleHtmlPreview()).toContain('chosen.html');
    expect(
      screen.getByRole('checkbox', { name: 'Select artifacts/chosen.html' }),
    ).toBeChecked();
  });
});

function visibleHtmlPreview(): string {
  const frame = screen
    .getAllByTitle('html artifact')
    .find((element) => element.closest('[aria-hidden="true"]') === null);
  return frame?.getAttribute('srcdoc') ?? '';
}

function ReloadHarness() {
  const [reloadSignal, setReloadSignal] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => setReloadSignal((value) => value + 1)}
      >
        Complete design run
      </button>
      <FileWorkspace
        projectId="design_completion"
        surface="prototype"
        outputs={[
          {
            id: 'out_primary',
            kind: 'html',
            path: 'artifacts/primary.html',
            createdAt: '2026-05-24T00:00:00.000Z',
          },
        ]}
        reloadSignal={reloadSignal}
      />
    </>
  );
}

const FILES_BEFORE = [
  { name: 'primary.html', path: 'artifacts/primary.html', isDir: false },
  { name: 'chosen.html', path: 'artifacts/chosen.html', isDir: false },
];

const FILES_AFTER = [
  ...FILES_BEFORE,
  { name: 'generated.html', path: 'artifacts/generated.html', isDir: false },
];

function mockWorkspaceFetch() {
  const pendingLists: Array<() => void> = [];
  let listCount = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/files')) {
      listCount += 1;
      const afterCompletion = listCount > 1;
      if (afterCompletion) {
        await new Promise<void>((resolve) => pendingLists.push(resolve));
      }
      return jsonResponse({
        files: afterCompletion ? FILES_AFTER : FILES_BEFORE,
      });
    }
    if (url.includes('/file?')) {
      const path =
        new URL(url, 'http://localhost').searchParams.get('path') ?? '';
      return jsonResponse({
        path,
        content: `<main><h1>${path}</h1></main>`,
      });
    }
    return jsonResponse({});
  }) as typeof fetch;

  return {
    releaseCompletionList() {
      const resolve = pendingLists.shift();
      if (!resolve) throw new Error('completion file list was not pending');
      resolve();
    },
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
