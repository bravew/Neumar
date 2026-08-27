import { createElement, type ReactNode } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectTemplateField } from '@/components/video/ProjectTemplateField';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(LanguageProvider, null, children);

function project(sceneCount: number): VideoProject {
  return {
    id: 'p',
    name: 'Clip',
    template: 'slideshow',
    prompt: '',
    assets: [],
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    storyboard: {
      status: 'edited',
      intent: 'x',
      totalDurationMs: 1000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: Array.from({ length: sceneCount }, (_, i) => ({
        id: `s-${i}`,
        durationMs: 1000,
        intent: 'x',
        assetPlan: { kind: 'ai-image', prompt: 'x' },
      })),
    },
  } as unknown as VideoProject;
}

describe('ProjectTemplateField', () => {
  it('is editable while no storyboard has been built', () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      createElement(ProjectTemplateField, { project: project(0), onPatch }),
      { wrapper },
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(false);

    fireEvent.change(select, { target: { value: 'custom' } });
    expect(onPatch).toHaveBeenCalledWith({ template: 'custom' });
  });

  it('locks once scenes exist, because they were built for this intent', () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      createElement(ProjectTemplateField, { project: project(3), onPatch }),
      { wrapper },
    );

    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(
      true,
    );
  });

  it('unlocks only after the consequences are accepted', () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      createElement(ProjectTemplateField, { project: project(3), onPatch }),
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button'));
    expect(confirm).toHaveBeenCalled();
    // Declined: still locked.
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(
      true,
    );

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(false);

    fireEvent.change(select, { target: { value: 'custom' } });
    expect(onPatch).toHaveBeenCalledWith({ template: 'custom' });
    confirm.mockRestore();
  });
});
