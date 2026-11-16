import { useState } from 'react';

import { act, screen, waitFor } from '@testing-library/react';
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

  it('ignores a file list that resolves after the project changes', async () => {
    const user = userEvent.setup();
    const workspace = mockWorkspaceFetch();
    const view = renderWithProviders(
      <ProjectSwitchHarness projectId="design_completion" />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Toggle file tree' }),
    );
    await screen.findByRole('button', { name: 'artifacts/chosen.html' });

    // The first project's response is already buffered. Its body resolves just
    // before the project change is applied, so the request is not aborted yet
    // and its list could replace the new project's list.
    const previousProject = workspace.holdNextList();
    await user.click(
      screen.getByRole('button', { name: 'Reload current project' }),
    );
    previousProject.releaseBefore(() => {
      view.rerender(<ProjectSwitchHarness projectId="design_next" />);
    });
    await screen.findByRole('button', { name: 'artifacts/next.html' });

    expect(
      screen.queryByRole('button', { name: 'artifacts/chosen.html' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'artifacts/next.html' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(visibleHtmlPreview()).toContain('next.html'));
  });

  it('keeps the newer file list when an older response for the same project resolves later', async () => {
    const user = userEvent.setup();
    const workspace = mockWorkspaceFetch();

    renderWithProviders(<ReloadHarness />);

    await user.click(
      await screen.findByRole('button', { name: 'Toggle file tree' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'artifacts/chosen.html' }),
    );
    await waitFor(() => expect(visibleHtmlPreview()).toContain('chosen.html'));

    const firstReload = workspace.holdNextList();
    await user.click(
      screen.getByRole('button', { name: 'Complete design run' }),
    );
    const secondReload = workspace.holdNextList();
    await user.click(
      screen.getByRole('button', { name: 'Complete design run' }),
    );

    // The newer list arrives, then the older body resolves. The older list
    // must not replace the newer one.
    secondReload.releaseBefore(() => {});
    await screen.findByRole('button', { name: 'artifacts/second.html' });
    await act(async () => {
      await new Promise<void>((resolve) => {
        firstReload.releaseBefore(resolve);
      });
    });

    expect(
      screen.getByRole('button', { name: 'artifacts/second.html' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'artifacts/generated.html' }),
    ).not.toBeInTheDocument();
    expect(visibleHtmlPreview()).toContain('chosen.html');
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

function ProjectSwitchHarness({ projectId }: { projectId: string }) {
  const [reloadSignal, setReloadSignal] = useState(0);
  const outputs =
    projectId === 'design_completion'
      ? [
          {
            id: 'out_primary',
            kind: 'html' as const,
            path: 'artifacts/primary.html',
            createdAt: '2026-05-24T00:00:00.000Z',
          },
        ]
      : [
          {
            id: 'out_next',
            kind: 'html' as const,
            path: 'artifacts/next.html',
            createdAt: '2026-05-24T00:00:00.000Z',
          },
        ];
  return (
    <>
      <button
        type="button"
        onClick={() => setReloadSignal((value) => value + 1)}
      >
        Reload current project
      </button>
      <FileWorkspace
        projectId={projectId}
        surface="prototype"
        outputs={outputs}
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

const FILES_SECOND = [
  ...FILES_BEFORE,
  { name: 'second.html', path: 'artifacts/second.html', isDir: false },
];

const FILES_NEXT = [
  { name: 'next.html', path: 'artifacts/next.html', isDir: false },
];

type WorkspaceFile = { name: string; path: string; isDir: boolean };

type HeldList = {
  releaseBody: (() => void) | null;
  releaseBefore: (continueWork: () => void) => void;
};

function filesForProject(url: string, listCount: number): WorkspaceFile[] {
  if (url.includes('/design_next/')) return FILES_NEXT;
  if (listCount > 2) return FILES_SECOND;
  if (listCount > 1) return FILES_AFTER;
  return FILES_BEFORE;
}

function mockWorkspaceFetch() {
  const pendingLists: Array<() => void> = [];
  const pendingHolds: HeldList[] = [];
  let listCount = 0;
  let holdNextList = false;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/files')) {
      listCount += 1;
      const files = filesForProject(url, listCount);
      if (!holdNextList && listCount > 1 && !url.includes('/design_next/')) {
        await new Promise<void>((resolve) => pendingLists.push(resolve));
      }
      const response = jsonResponse({ files });
      if (holdNextList) {
        holdNextList = false;
        const held = pendingHolds.shift();
        if (!held) throw new Error('file list was held without a handle');
        const originalJson = response.json.bind(response);
        response.json = () =>
          new Promise((resolve) => {
            held.releaseBody = () => {
              resolve(originalJson());
            };
          });
      }
      return response;
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
    holdNextList() {
      const held: HeldList = {
        releaseBody: null,
        releaseBefore(continueWork: () => void) {
          if (!held.releaseBody) throw new Error('file list was not held');
          held.releaseBody();
          queueMicrotask(continueWork);
        },
      };
      pendingHolds.push(held);
      holdNextList = true;
      return held;
    },
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
