import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatInput } from '@/components/shared/ChatInput';
import { expandSearchSlashCommand } from '@/components/shared/ChatInput.types';

// Mock heavy/Tauri-dependent modules
vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      home: {
        addFilesOrPhotos: 'Add files or photos',
        selectedFolder: 'Selected folder',
        chatInputDefaultPlaceholder: 'Ask anything',
      },
      cloudStorage: {
        cloudStoragePickerLabel: 'Cloud media',
        cloudStoragePickerTitle: 'Attach cloud media',
        cloudStoragePickerDescription: 'Choose media',
        loadingMedia: 'Loading media...',
        noCloudStorageConnections: 'No connections',
        selectedMediaCount: '{count} selected',
        attachSelectedMedia: 'Attach selected',
        mediaSearchPlaceholder: 'Search media...',
        folderBack: 'Back',
        mediaKindAll: 'All',
        mediaKindImages: 'Images',
        mediaKindVideos: 'Videos',
        mediaKindAudio: 'Audio',
        mediaKindDocuments: 'Documents',
        mediaKindFolders: 'Folders',
        noMediaResults: 'No media results.',
      },
      assets: {
        browseCatalog: 'Browse asset catalog',
        browseCatalogDescription: 'Pick assets from the workspace catalog.',
        resultsCount: '{count} assets',
        selectedCount: '{count} selected',
        searchPlaceholder: 'Search assets…',
        clearSearch: 'Clear search',
        semantic: 'Semantic',
        loading: 'Loading…',
        emptyTitle: 'No assets',
        emptyHint: 'Try another query',
        error: 'Failed to load assets',
        loadingMore: 'Loading more…',
        configureSources: 'Configure asset sources',
        attachSelected: 'Attach {count}',
        attachAll: 'Attach',
        cancel: 'Cancel',
        cancelDownload: 'Cancel download',
        retryDownload: 'Retry download',
      },
      settings: {},
    },
    tt: (key: string) => key,
  }),
}));

vi.mock('@/components/shared/FolderPicker', () => ({
  FolderPicker: () => null,
}));

vi.mock('@/components/shared/SlashCommandMenu', () => ({
  SlashCommandMenu: () => null,
}));

vi.mock('@/config', () => ({
  API_BASE_URL: 'http://localhost:5126',
}));

const noop = async () => {};

describe('ChatInput component', () => {
  it('renders a textarea', () => {
    render(<ChatInput onSubmit={noop} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders with custom placeholder', () => {
    render(<ChatInput onSubmit={noop} placeholder="Ask anything..." />);
    expect(screen.getByPlaceholderText('Ask anything...')).toBeInTheDocument();
  });

  it('renders buttons when isRunning is true', () => {
    render(<ChatInput onSubmit={noop} isRunning={true} onStop={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('disables textarea when disabled prop is true', () => {
    render(<ChatInput onSubmit={noop} disabled={true} />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('submits with external context and no typed text', async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} hasExternalSubmitContext />);

    fireEvent.click(screen.getByTestId('chat-submit-button'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        '',
        undefined,
        undefined,
        undefined,
      );
    });
  });

  it('expands /search submissions into research tool instructions', () => {
    const expanded = expandSearchSlashCommand('/search React 19 release notes');
    expect(expanded).toContain('research tool');
    expect(expanded).toContain('depth="quick"');
    expect(expanded).toContain('Query: React 19 release notes');
  });
});
