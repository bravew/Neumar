import type { ComponentProps } from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProjectAssetsEmptyState } from '@/components/video/assets/ProjectAssetsEmptyState';
import { ProjectAssetsHeader } from '@/components/video/assets/ProjectAssetsHeader';

import { renderWithProviders } from '../helpers/render-with-providers';

type HeaderProps = ComponentProps<typeof ProjectAssetsHeader>;

const labels: HeaderProps['labels'] = {
  projectAssets: 'Project assets',
  browseProjectAssets: 'Browse',
  addFiles: 'Add file(s)',
  addFolder: 'Add folder',
  addAssets: 'Add assets',
  connectCloud: 'Connect cloud',
  inContext: '{count} in context',
  inContextHint: 'Assets the agent reasons over',
};

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    labels,
    browseCatalogLabel: 'Browse catalog',
    newCount: 0,
    uniqueProjectAssetCount: 0,
    contextCount: 0,
    contextOnly: false,
    addingFolder: false,
    addingFiles: false,
    onOpenBrowser: vi.fn(),
    onOpenCatalog: vi.fn(),
    onAddLocalFiles: vi.fn(),
    onAddLocalFolder: vi.fn(),
    onConnectCloud: vi.fn(),
    onToggleContextOnly: vi.fn(),
    ...overrides,
  };
  render(<ProjectAssetsHeader {...props} />);
  return props;
}

describe('ProjectAssetsHeader', () => {
  it('routes the unified Add menu to local, cloud, and catalog handlers', async () => {
    const user = userEvent.setup();
    const props = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add assets' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Add file(s)' }),
    );
    expect(props.onAddLocalFiles).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Add assets' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Add folder' }),
    );
    expect(props.onAddLocalFolder).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Add assets' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Connect cloud' }),
    );
    expect(props.onConnectCloud).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Add assets' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Browse catalog' }),
    );
    expect(props.onOpenCatalog).toHaveBeenCalledOnce();
  });

  it('shows the in-context chip with the count and toggles the filter', async () => {
    const user = userEvent.setup();
    const props = renderHeader({ contextCount: 3 });

    const chip = screen.getByRole('button', { name: '3 in context' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(props.onToggleContextOnly).toHaveBeenCalledOnce();
  });

  it('hides the in-context chip when nothing is in context', () => {
    renderHeader({ contextCount: 0 });
    expect(screen.queryByText(/in context/)).not.toBeInTheDocument();
  });
});

describe('ProjectAssetsEmptyState', () => {
  it('offers file, folder, cloud, and catalog entry points', async () => {
    const user = userEvent.setup();
    const onAddLocalFiles = vi.fn();
    const onAddLocalFolder = vi.fn();
    const onConnectCloud = vi.fn();
    const onOpenCatalog = vi.fn();

    renderWithProviders(
      <ProjectAssetsEmptyState
        addingFolder={false}
        addingFiles={false}
        onAddLocalFiles={onAddLocalFiles}
        onAddLocalFolder={onAddLocalFolder}
        onConnectCloud={onConnectCloud}
        onOpenCatalog={onOpenCatalog}
      />,
    );

    await user.click(screen.getByRole('button', { name: /add file/i }));
    await user.click(screen.getByRole('button', { name: /add folder/i }));
    await user.click(screen.getByRole('button', { name: /connect cloud/i }));
    await user.click(screen.getByRole('button', { name: /browse catalog/i }));

    expect(onAddLocalFiles).toHaveBeenCalledOnce();
    expect(onAddLocalFolder).toHaveBeenCalledOnce();
    expect(onConnectCloud).toHaveBeenCalledOnce();
    expect(onOpenCatalog).toHaveBeenCalledOnce();
  });

  it('disables the file and folder actions while a pick is in flight', async () => {
    renderWithProviders(
      <ProjectAssetsEmptyState
        addingFolder
        addingFiles
        onAddLocalFiles={vi.fn()}
        onAddLocalFolder={vi.fn()}
        onConnectCloud={vi.fn()}
        onOpenCatalog={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /add folder/i }),
      ).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: /add file/i })).toBeDisabled();
  });
});
