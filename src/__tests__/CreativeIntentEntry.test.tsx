import { useState } from 'react';

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreativeIntentEntry } from '@/components/creative/CreativeIntentEntry';
import type { CreativeIntentId } from '@/shared/creative-workflow';
import {
  clearCreativeDebugCounters,
  readCreativeDebugCounters,
} from '@/shared/creative-workflow/debug-counters';

import { installLocalStorageMock } from './helpers/local-storage';
import { renderWithProviders } from './helpers/render-with-providers';

const labels = {
  title: 'Choose what to make',
  promptLabel: 'Starting idea',
  promptPlaceholder: 'Describe the output',
  startFailed: 'Could not start: {message}',
  start: 'Start',
  disabledIntentReason: 'Coming soon',
  intent: {
    design: 'Design',
    video: 'Video',
    image: 'Image',
    audio: 'Audio',
    assets: 'From assets',
    template: 'From template',
    import: 'From URL/file/folder',
  } satisfies Record<CreativeIntentId, string>,
};

describe('CreativeIntentEntry', () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => clearCreativeDebugCounters());

  it('selects an intent and submits the prompt', async () => {
    const user = userEvent.setup();
    const onSelectIntent = vi.fn();
    const onPromptChange = vi.fn();
    const onStart = vi.fn();

    renderWithProviders(
      <Harness
        onSelectIntent={onSelectIntent}
        onPromptChange={onPromptChange}
        onStart={onStart}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Image' }));
    await user.type(screen.getByPlaceholderText('Describe the output'), 'Hero');
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(onSelectIntent).toHaveBeenCalledWith('image');
    expect(onPromptChange).toHaveBeenLastCalledWith('Hero');
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(
      readCreativeDebugCounters().events['entry.intent.selected']?.count,
    ).toBe(1);
  });

  it('explains disabled intent options', () => {
    renderWithProviders(
      <CreativeIntentEntry
        labels={labels}
        selectedIntent="design"
        prompt=""
        onSelectIntent={vi.fn()}
        onPromptChange={vi.fn()}
        onStart={vi.fn()}
        disabledIntents={{ assets: true }}
      />,
    );

    const assets = screen.getByRole('radio', { name: 'From assets' });

    expect(assets).toBeDisabled();
    expect(assets).toHaveAccessibleDescription('Coming soon');
    expect(assets.closest('label')).toHaveAttribute('title', 'Coming soon');
  });
});

function Harness({
  onSelectIntent,
  onPromptChange,
  onStart,
}: {
  onSelectIntent: (intent: CreativeIntentId) => void;
  onPromptChange: (prompt: string) => void;
  onStart: () => void;
}) {
  const [intent, setIntent] = useState<CreativeIntentId>('design');
  const [prompt, setPrompt] = useState('');
  return (
    <CreativeIntentEntry
      labels={labels}
      selectedIntent={intent}
      prompt={prompt}
      onSelectIntent={(next) => {
        setIntent(next);
        onSelectIntent(next);
      }}
      onPromptChange={(next) => {
        setPrompt(next);
        onPromptChange(next);
      }}
      onStart={onStart}
    />
  );
}
