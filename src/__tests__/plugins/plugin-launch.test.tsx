/**
 * End-to-end coverage for the marketplace "Use" → working-session flow in
 * design and video mode: clicking Use must create a project seeded with the
 * plugin's example query and open it (not just land on the gallery).
 *
 * We drive the mode-specific launchers (the logic the entries invoke via
 * usePluginLaunch) with mocked project-creation APIs and assert the project is
 * created with the right prompt/surface and then opened.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActivePlugin } from '@/shared/hooks/useActivePlugin';
import type { InstalledPlugin } from '@/shared/hooks/usePlugins';

const { createVideoProject, createDesignProject, activePluginState } =
  vi.hoisted(() => ({
    createVideoProject: vi.fn(),
    createDesignProject: vi.fn(),
    activePluginState: { active: null as ActivePlugin | null },
  }));

vi.mock('@/shared/hooks/useVideoProject', () => ({ createVideoProject }));
vi.mock('@/shared/hooks/useDesignMode', () => ({ createDesignProject }));
vi.mock('@/shared/hooks/useActivePlugin', () => ({
  useActivePlugin: () => ({
    active: activePluginState.active,
    dismiss: vi.fn(),
    clearSeed: vi.fn(),
  }),
}));

import { launchVideoPlugin } from '@/app/pages/VideoMode/launchVideoPlugin';
import { launchDesignPlugin } from '@/components/design/launchDesignPlugin';
import { usePluginLaunch } from '@/shared/hooks/usePluginLaunch';

function makeActive(
  overrides: {
    id?: string;
    name?: string;
    exampleQuery?: string;
    designManifest?: string;
    description?: string;
  } = {},
): ActivePlugin {
  const {
    id = 'user/hallmark',
    name = 'Hallmark',
    designManifest,
    description = 'A design skill.',
  } = overrides;
  const exampleQuery =
    'exampleQuery' in overrides
      ? overrides.exampleQuery
      : 'Use Hallmark to redesign this page.';
  const plugin = {
    id,
    name: id.split('/').pop() ?? id,
    manifest: {
      displayName: name,
      description,
      metadata: {
        neuma: {
          surfaces: ['design'],
          ...(exampleQuery ? { exampleQuery } : {}),
          ...(designManifest ? { designManifest } : {}),
        },
      },
    },
  } as unknown as InstalledPlugin;
  return { plugin, name, exampleQuery, seed: true };
}

afterEach(() => {
  vi.clearAllMocks();
  activePluginState.active = null;
});

describe('launchVideoPlugin', () => {
  it('creates a video project seeded with the example query and opens it', async () => {
    createVideoProject.mockResolvedValue({ project: { id: 'vid-1' } });
    const navigate = vi.fn();
    const onError = vi.fn();

    await launchVideoPlugin(makeActive(), {
      navigate,
      defaultProjectName: 'Untitled video',
      onError,
    });

    expect(createVideoProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Untitled video',
        prompt: 'Use Hallmark to redesign this page.',
      }),
    );
    expect(navigate).toHaveBeenCalledWith('/video/vid-1');
    expect(onError).not.toHaveBeenCalled();
  });

  it('falls back to the description when there is no example query', async () => {
    createVideoProject.mockResolvedValue({ project: { id: 'vid-2' } });
    await launchVideoPlugin(
      makeActive({ exampleQuery: undefined, description: 'Video plugin desc' }),
      { navigate: vi.fn(), defaultProjectName: 'Untitled', onError: vi.fn() },
    );
    expect(createVideoProject).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Video plugin desc' }),
    );
  });

  it('reports errors without navigating', async () => {
    createVideoProject.mockRejectedValue(new Error('boom'));
    const navigate = vi.fn();
    const onError = vi.fn();
    await launchVideoPlugin(makeActive(), {
      navigate,
      defaultProjectName: 'Untitled',
      onError,
    });
    expect(onError).toHaveBeenCalledWith('boom');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('launchDesignPlugin', () => {
  it('creates a prototype design project seeded with the example query and opens it', async () => {
    createDesignProject.mockResolvedValue({ project: { id: 'des-1' } });
    const onOpen = vi.fn();

    await launchDesignPlugin(makeActive(), { onOpen, locale: 'en' });

    expect(createDesignProject).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'prototype',
        brief: expect.objectContaining({
          prompt: 'Use Hallmark to redesign this page.',
          pluginId: 'user/hallmark',
        }),
      }),
    );
    // A plain design skill carries no design-system id.
    expect(createDesignProject.mock.calls[0][0]).not.toHaveProperty(
      'designSystemId',
    );
    expect(onOpen).toHaveBeenCalledWith({ id: 'des-1' });
  });

  it('applies the design system for a bundled design-system plugin', async () => {
    createDesignProject.mockResolvedValue({ project: { id: 'des-2' } });
    await launchDesignPlugin(
      makeActive({
        id: 'bundled/design-system-airbnb',
        name: 'Airbnb',
        exampleQuery: undefined,
        designManifest: './design-plugin.json',
      }),
      { onOpen: vi.fn(), locale: 'en' },
    );
    expect(createDesignProject).toHaveBeenCalledWith(
      expect.objectContaining({
        designSystemId: 'airbnb',
        surface: 'prototype',
      }),
    );
  });
});

describe('usePluginLaunch', () => {
  it('fires the launcher once when an active plugin is present', () => {
    activePluginState.active = makeActive();
    const launch = vi.fn();
    const { rerender } = renderHook(() => usePluginLaunch(launch));
    rerender();
    rerender();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(activePluginState.active);
  });

  it('does not fire when disabled or when there is no active plugin', () => {
    activePluginState.active = null;
    const launch = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => usePluginLaunch(launch, enabled),
      { initialProps: { enabled: true } },
    );
    expect(launch).not.toHaveBeenCalled();

    activePluginState.active = makeActive();
    rerender({ enabled: false });
    expect(launch).not.toHaveBeenCalled();
  });
});
