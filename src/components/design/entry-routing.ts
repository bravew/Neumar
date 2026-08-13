import type { DesignSurface } from '@/shared/types/design-mode';

import type { MediaSurface } from './MediaSurfacePicker';

export type EntryTab =
  | 'designs'
  | 'examples'
  | 'design-systems'
  | 'image-templates'
  | 'video-templates'
  | 'skills'
  | 'routines';

export const ENTRY_TABS: Array<{ id: EntryTab }> = [
  { id: 'designs' },
  { id: 'examples' },
  { id: 'design-systems' },
  { id: 'image-templates' },
  { id: 'video-templates' },
  { id: 'skills' },
  { id: 'routines' },
];

export type EntryPanelSurface = DesignSurface | 'other' | 'media';

type EntryTabMessages = {
  design: {
    tabs: {
      designs: string;
      examples: string;
      designSystems: string;
      imageTemplates: string;
      videoTemplates: string;
      routines: string;
      skills: string;
    };
  };
};

export function tabFromHash(hash: string): EntryTab | null {
  const value = hash.replace(/^#/, '');
  const directTab = ENTRY_TABS.find((item) => item.id === value)?.id;
  return directTab ?? null;
}

export function entrySurfaceFromSearch(search: string): {
  initialSurface: EntryPanelSurface;
  initialMediaSurface: MediaSurface;
} {
  const params = new URLSearchParams(search);
  const surface = params.get('surface');
  if (isMediaSurface(surface)) {
    return { initialSurface: 'media', initialMediaSurface: surface };
  }
  if (surface === 'media') {
    const media = params.get('media');
    return {
      initialSurface: 'media',
      initialMediaSurface: isMediaSurface(media) ? media : 'image',
    };
  }
  if (isEntryPanelSurface(surface)) {
    return { initialSurface: surface, initialMediaSurface: 'image' };
  }
  return { initialSurface: 'prototype', initialMediaSurface: 'image' };
}

export function entryPromptFromSearch(search: string): string {
  return new URLSearchParams(search).get('prompt') ?? '';
}

export function entryTabLabel(t: EntryTabMessages, tab: EntryTab): string {
  if (tab === 'designs') return t.design.tabs.designs;
  if (tab === 'examples') return t.design.tabs.examples;
  if (tab === 'design-systems') return t.design.tabs.designSystems;
  if (tab === 'image-templates') return t.design.tabs.imageTemplates;
  if (tab === 'video-templates') return t.design.tabs.videoTemplates;
  if (tab === 'routines') return t.design.tabs.routines;
  return t.design.tabs.skills;
}

function isMediaSurface(value: string | null): value is MediaSurface {
  return value === 'image' || value === 'video' || value === 'audio';
}

function isEntryPanelSurface(value: string | null): value is EntryPanelSurface {
  return (
    value === 'document' ||
    value === 'prototype' ||
    value === 'deck' ||
    value === 'template' ||
    value === 'campaign' ||
    value === 'other'
  );
}
