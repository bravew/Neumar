import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineOptionRow } from '@/components/video/EngineOptionRow';
import { EnginePicker } from '@/components/video/EnginePicker';
import type { VideoEngineOption } from '@/shared/video/useVideoEngines';

import { renderWithProviders as render } from '../helpers/render-with-providers';

const ENGINES: {
  schema: string;
  recommendedEngineId: string;
  engines: VideoEngineOption[];
} = {
  schema: 'neuma.video.engine-options.v1',
  recommendedEngineId: 'remotion',
  engines: [
    {
      id: 'remotion',
      name: 'Remotion',
      version: '4.0.515',
      installed: true,
      detectedVersion: '4.0.515',
      bestFor: ['React compositions'],
      weaknesses: ['Slower renders'],
      outputFormats: ['mp4'],
      alpha: false,
      licensing: 'Remotion License',
    },
    {
      id: 'hyperframes',
      name: 'HyperFrames',
      version: '0.8.7',
      installed: false,
      unavailableReason: 'browser-missing',
      detectedVersion: '0.8.7',
      detail: 'Chrome not found',
      bestFor: ['Deterministic HTML animation'],
      weaknesses: ['Requires the HyperFrames CLI'],
      outputFormats: ['mp4', 'webm-alpha'],
      alpha: true,
      licensing: 'Apache-2.0',
    },
  ],
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ENGINES });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EnginePicker', () => {
  it('shows the active engine and its version', async () => {
    render(<EnginePicker engineId="remotion" />);
    await waitFor(() =>
      expect(screen.getByTestId('engine-picker')).toHaveTextContent('Remotion'),
    );
  });

  it('renders the setup prompt with an install command when the engine is unavailable', async () => {
    render(<EnginePicker engineId="hyperframes" />);

    const prompt = await screen.findByTestId('engine-setup-hyperframes');
    expect(prompt).toHaveTextContent(
      'HyperFrames is installed, but its rendering browser is missing.',
    );
    expect(prompt).toHaveTextContent('hyperframes browser install');
    expect(prompt).toHaveTextContent('Chrome not found');
  });

  it('re-probes when the user asks to check again', async () => {
    render(<EnginePicker engineId="hyperframes" />);
    await screen.findByTestId('engine-setup-hyperframes');
    const calls = fetchSpy.mock.calls.length;

    fireEvent.click(screen.getByText('Check again'));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(calls),
    );
  });

  it('does not render a setup prompt for an available engine', async () => {
    render(<EnginePicker engineId="remotion" />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByTestId('engine-setup-remotion')).toBeNull();
  });
});

describe('EngineOptionRow', () => {
  it('presents the engine with its honest tradeoffs', () => {
    render(
      <EngineOptionRow
        engine={ENGINES.engines[0]!}
        active
        unavailableLabel="Not set up"
      />,
    );
    expect(screen.getByText('Remotion')).toBeInTheDocument();
    expect(
      screen.getByText('React compositions · Slower renders'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Not set up')).toBeNull();
  });

  it('marks an unavailable engine instead of hiding it', () => {
    render(
      <EngineOptionRow
        engine={ENGINES.engines[1]!}
        active={false}
        unavailableLabel="Not set up"
      />,
    );
    expect(screen.getByText('HyperFrames')).toBeInTheDocument();
    expect(screen.getByText('Not set up')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Deterministic HTML animation · Requires the HyperFrames CLI',
      ),
    ).toBeInTheDocument();
  });
});
