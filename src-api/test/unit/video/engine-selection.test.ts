import { beforeEach, describe, expect, it } from 'vitest';

import {
  _resetVideoEngineRegistry,
  assertEngineAdapterAvailable,
  EngineSelectionError,
  listEngineSelectionOptions,
  registerVideoEngine,
  selectVideoEngine,
  type EngineAvailability,
  type VideoEngineAdapter,
} from '@/shared/video/engines';

function stubAdapter(
  id: string,
  availability: EngineAvailability,
  extras: Partial<VideoEngineAdapter['capabilities']> = {},
): VideoEngineAdapter {
  return {
    id,
    name: id.toUpperCase(),
    upstreamVersion: '1.0.0',
    capabilities: {
      paradigms: ['html-css-gsap'],
      outputFormats: ['mp4'],
      maxResolution: { width: 1920, height: 1080 },
      alpha: false,
      audio: 'multi',
      subtitles: 'burn-in',
      renderTarget: ['local-node'],
      fps: [{ num: 30, den: 1 }],
      licensing: 'Apache-2.0',
      ...extras,
    },
    probeAvailability: () => availability,
    validate: () => ({ ok: true, issues: [] }),
    render: () => {
      throw new Error('not used');
    },
  };
}

describe('runtime-selection contract', () => {
  beforeEach(() => {
    _resetVideoEngineRegistry();
  });

  it('presents every engine with its tradeoffs, including unavailable ones', async () => {
    registerVideoEngine(
      stubAdapter(
        'remotion',
        { installed: true, version: '4.0.515' },
        { bestFor: ['React compositions'], weaknesses: ['Slower renders'] },
      ),
    );
    registerVideoEngine(
      stubAdapter('hyperframes', {
        installed: false,
        reason: 'browser-missing',
        version: '0.8.7',
        detail: 'Chrome not found',
      }),
    );

    const options = await listEngineSelectionOptions();
    expect(options.map((option) => option.id)).toEqual([
      'remotion',
      'hyperframes',
    ]);
    expect(options[0]).toMatchObject({
      installed: true,
      bestFor: ['React compositions'],
      weaknesses: ['Slower renders'],
    });
    expect(options[1]).toMatchObject({
      installed: false,
      unavailableReason: 'browser-missing',
      detectedVersion: '0.8.7',
      detail: 'Chrome not found',
    });
  });

  it('escalates instead of substituting when the requested engine is unavailable', async () => {
    registerVideoEngine(
      stubAdapter('remotion', { installed: true, version: '1' }),
    );
    registerVideoEngine(
      stubAdapter('hyperframes', { installed: false, reason: 'not-found' }),
    );

    await expect(
      selectVideoEngine({ requestedEngineId: 'hyperframes' }),
    ).rejects.toMatchObject({
      name: 'EngineSelectionError',
      code: 'engine-unavailable',
    });

    // and the error carries every option that was considered
    const error = await selectVideoEngine({
      requestedEngineId: 'hyperframes',
    }).catch((err: unknown) => err as EngineSelectionError);
    expect(error).toBeInstanceOf(EngineSelectionError);
    expect(
      (error as EngineSelectionError).decisionInput.options.map((o) => o.id),
    ).toEqual(['remotion', 'hyperframes']);
    expect(
      (error as EngineSelectionError).decisionInput.unavailableReason,
    ).toBe('not-found');
  });

  it('records the decision with every option when one is requested', async () => {
    registerVideoEngine(
      stubAdapter('remotion', { installed: true, version: '1' }),
    );
    registerVideoEngine(stubAdapter('html', { installed: true, version: '2' }));

    const decision = await selectVideoEngine({ requestedEngineId: 'html' });
    expect(decision).toMatchObject({
      schema: 'neuma.video.engine-selection.v1',
      selectedEngineId: 'html',
      reason: 'explicit-request',
    });
    expect(decision.options.map((option) => option.id)).toEqual([
      'remotion',
      'html',
    ]);
  });

  it('falls back to preference order only when nothing was requested', async () => {
    registerVideoEngine(
      stubAdapter('remotion', { installed: false, reason: 'not-found' }),
    );
    registerVideoEngine(stubAdapter('html', { installed: true, version: '2' }));

    const decision = await selectVideoEngine();
    expect(decision.selectedEngineId).toBe('html');
    expect(decision.reason).toBe('only-available');
  });

  it('rejects an unknown engine id', async () => {
    registerVideoEngine(stubAdapter('html', { installed: true, version: '2' }));
    await expect(
      selectVideoEngine({ requestedEngineId: 'nope' }),
    ).rejects.toMatchObject({ code: 'unknown-engine' });
  });

  it('reports no-engine-available when nothing can run', async () => {
    registerVideoEngine(
      stubAdapter('html', { installed: false, reason: 'browser-missing' }),
    );
    await expect(selectVideoEngine()).rejects.toMatchObject({
      code: 'no-engine-available',
    });
  });

  it('pre-flights an adapter instance the registry never saw', async () => {
    const available = stubAdapter('fake', { installed: true, version: '9' });
    await expect(
      assertEngineAdapterAvailable(available),
    ).resolves.toMatchObject({ selectedEngineId: 'fake' });

    const missing = stubAdapter('fake', {
      installed: false,
      reason: 'version-too-old',
      version: '0.1.0',
      requiredVersion: '0.8.7',
    });
    await expect(assertEngineAdapterAvailable(missing)).rejects.toMatchObject({
      code: 'engine-unavailable',
    });
  });

  it('treats a throwing probe as not-found rather than a crash', async () => {
    const throwing: VideoEngineAdapter = {
      ...stubAdapter('boom', { installed: true, version: '1' }),
      probeAvailability: () => {
        throw new Error('probe exploded');
      },
    };
    await expect(assertEngineAdapterAvailable(throwing)).rejects.toMatchObject({
      code: 'engine-unavailable',
    });
  });
});
