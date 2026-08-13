import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatInput } from '@/components/shared/ChatInput';

import { renderWithProviders } from './helpers/render-with-providers';

vi.mock('@/shared/hooks/useMcpServers', () => ({
  useMcpServers: () => ({
    servers: [{ name: 'figma', type: 'stdio', source: 'app' }],
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/useSkills', () => ({
  useSkills: () => ({
    skills: [],
    loading: false,
    error: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/useSpeech', () => ({
  useSpeech: () => ({
    isListening: false,
    startListening: vi.fn(async () => {}),
    stopListening: vi.fn(),
  }),
}));

vi.mock('@/shared/db/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/db/settings')>();
  const settings = {
    ...actual.defaultSettings,
    language: 'en-US',
    providers: [],
    speech: {},
  };
  return {
    ...actual,
    getSettings: vi.fn(() => settings),
    saveSettings: vi.fn(),
    useSettingsValue: () => settings,
  };
});

vi.mock('@/components/shared/McpSelector', () => ({
  McpSelector: ({
    forceOpen,
    mentionFilter,
  }: {
    forceOpen: boolean;
    mentionFilter: string;
  }) => (
    <div
      data-testid="mcp-state"
      data-open={String(forceOpen)}
      data-filter={mentionFilter}
    />
  ),
}));

vi.mock('@/components/shared/CloudStorageAssetPicker', () => ({
  CloudStorageAssetPicker: () => null,
}));

describe('useChatInputState IME mention handling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers mention detection until IME composition ends', () => {
    vi.useFakeTimers();
    renderWithProviders(<ChatInput onSubmit={vi.fn()} />);

    const textarea = screen.getByTestId(
      'chat-input-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '@fig' } });
    textarea.setSelectionRange(4, 4);

    expect(screen.getByTestId('mcp-state')).toHaveAttribute(
      'data-open',
      'false',
    );
    expect(screen.getByTestId('mcp-state')).toHaveAttribute('data-filter', '');

    fireEvent.compositionEnd(textarea);
    act(() => {
      vi.advanceTimersByTime(11);
    });

    expect(screen.getByTestId('mcp-state')).toHaveAttribute(
      'data-open',
      'true',
    );
    expect(screen.getByTestId('mcp-state')).toHaveAttribute(
      'data-filter',
      'fig',
    );
  });

  it('keeps the existing letter-before-at mention suppression', () => {
    renderWithProviders(<ChatInput onSubmit={vi.fn()} />);

    const textarea = screen.getByTestId(
      'chat-input-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'email@fig' } });

    expect(screen.getByTestId('mcp-state')).toHaveAttribute(
      'data-open',
      'false',
    );
  });
});
