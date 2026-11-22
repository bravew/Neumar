import { open } from '@tauri-apps/plugin-dialog';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadDestinationPicker } from '@/components/task/DownloadDestinationPicker';
import en from '@/config/locale/messages/en/mediaDownload';
import es from '@/config/locale/messages/es/mediaDownload';
import fr from '@/config/locale/messages/fr/mediaDownload';
import hi from '@/config/locale/messages/hi/mediaDownload';
import pt from '@/config/locale/messages/pt/mediaDownload';
import zh from '@/config/locale/messages/zh/mediaDownload';
import { DOWNLOAD_DESTINATION_QUESTION } from '@/shared/downloads/destination';

import { renderWithProviders } from './helpers/render-with-providers';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

// The provider detects the host language; the picker's copy is asserted in
// English so the test does not depend on the machine.
vi.mock('@/shared/providers/language-provider', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/providers/language-provider')
  >('@/shared/providers/language-provider');
  const messages = (await import('@/config/locale/messages/en')).default;
  return {
    ...actual,
    useLanguage: () => ({ t: messages, language: 'en', setLanguage: vi.fn() }),
  };
});

const openDialog = vi.mocked(open);
const fetchMock = vi.fn();

beforeEach(() => {
  openDialog.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
});

describe('download destination copy', () => {
  it.each([en, es, fr, hi, pt, zh])(
    'translates the question and the picker in every locale',
    (messages) => {
      expect(messages.destination.question).toBeTruthy();
      expect(messages.destination.chooseFolder).toBeTruthy();
      expect(messages.destination.browserHint).toBeTruthy();
      expect(messages.destination.pathLabel).toBeTruthy();
      expect(messages.destination.pathPlaceholder).toBeTruthy();
      expect(messages.destination.useFolder).toBeTruthy();
      expect(messages.destination.pickFailed).toBeTruthy();
    },
  );

  it('uses the question text the server stores as its answer key', () => {
    // The server records the answer under this text and compares the transcript
    // line with it; a different string would make every resume a mismatch.
    expect(DOWNLOAD_DESTINATION_QUESTION).toBe(
      'Where should the videos be saved?',
    );
  });
});

describe('DownloadDestinationPicker', () => {
  it('opens the folder dialog in the desktop app and submits the checked folder', async () => {
    // The runtime check reads the window, not the env; simulate the shell.
    (
      window as unknown as { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    openDialog.mockResolvedValue('/Users/me/Videos');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ directory: '/Users/me/Videos' }),
    });
    const onChoose = vi.fn();

    renderWithProviders(
      <DownloadDestinationPicker taskId="task-1" onChoose={onChoose} />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /choose another folder/i }),
    );

    await waitFor(() =>
      expect(onChoose).toHaveBeenCalledWith('/Users/me/Videos'),
    );
    expect(openDialog).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false }),
    );
  });

  it('reports a folder the server refuses and submits nothing', async () => {
    (
      window as unknown as { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    openDialog.mockResolvedValue('/etc');
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'This folder is unavailable or not permitted.',
      }),
    });
    const onChoose = vi.fn();

    renderWithProviders(
      <DownloadDestinationPicker taskId="task-1" onChoose={onChoose} />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /choose another folder/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /unavailable or not permitted/i,
    );
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('lets a browser tab type a folder path and submits the checked folder', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ directory: '/Users/me/Videos/hk' }),
    });
    const onChoose = vi.fn();

    renderWithProviders(
      <DownloadDestinationPicker taskId="task-1" onChoose={onChoose} />,
    );
    // No folder dialog exists in a browser, so there is no dead button.
    expect(
      screen.queryByRole('button', { name: /choose another folder/i }),
    ).toBeNull();
    const input = screen.getByRole('textbox', { name: /folder path/i });
    const submit = screen.getByRole('button', { name: /use this folder/i });
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: '  /Users/me/Videos/hk  ' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(onChoose).toHaveBeenCalledWith('/Users/me/Videos/hk'),
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/downloads\/destination$/);
    expect(JSON.parse(init.body as string)).toEqual({
      taskId: 'task-1',
      path: '/Users/me/Videos/hk',
    });
    expect(openDialog).not.toHaveBeenCalled();
  });

  it('submits a typed path with Enter and reports a refused folder', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Saving to this folder is not allowed.' }),
    });
    const onChoose = vi.fn();

    renderWithProviders(
      <DownloadDestinationPicker taskId="task-1" onChoose={onChoose} />,
    );
    const input = screen.getByRole('textbox', { name: /folder path/i });
    fireEvent.change(input, { target: { value: '/etc' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(await screen.findByRole('alert')).toHaveTextContent(/not allowed/i);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('keeps the typed path beside the dialog button in the desktop app', () => {
    (
      window as unknown as { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    renderWithProviders(
      <DownloadDestinationPicker taskId="task-1" onChoose={vi.fn()} />,
    );
    expect(
      screen.getByRole('button', { name: /choose another folder/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole('textbox', { name: /folder path/i }),
    ).toBeInTheDocument();
  });
});
