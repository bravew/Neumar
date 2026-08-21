import { describe, expect, it } from 'vitest';

import {
  filterAndSortVideoProjects,
  parseVideoProjectSort,
  toggleProjectSelection,
  toggleVisibleProjectSelection,
} from '@/app/pages/VideoMode/videoProjectLibraryUtils';
import type { VideoProjectListItem } from '@/shared/types/video';

const projects: VideoProjectListItem[] = [
  project('video_1', 'Launch Reel', 'slideshow', 'completed', '2026-08-01'),
  project('video_2', 'Podcast Teaser', 'podcast', 'rendering', '2026-08-03'),
  project('video_3', 'Launch Recap', 'slideshow', 'idle', '2026-08-02'),
];

describe('video project library', () => {
  it('searches names and combines template and status filters', () => {
    expect(
      filterAndSortVideoProjects(projects, {
        query: ' launch ',
        template: 'slideshow',
        renderStatus: 'completed',
        sort: 'updated-desc',
      }).map((project) => project.id),
    ).toEqual(['video_1']);
  });

  it('sorts without mutating the source project order', () => {
    expect(
      filterAndSortVideoProjects(projects, {
        query: '',
        template: 'all',
        renderStatus: 'all',
        sort: 'name-desc',
      }).map((project) => project.name),
    ).toEqual(['Podcast Teaser', 'Launch Reel', 'Launch Recap']);
    expect(projects.map((project) => project.id)).toEqual([
      'video_1',
      'video_2',
      'video_3',
    ]);
  });

  it('toggles one project and all visible projects', () => {
    const oneSelected = toggleProjectSelection(new Set(), 'video_1');
    expect([...oneSelected]).toEqual(['video_1']);
    expect([...toggleProjectSelection(oneSelected, 'video_1')]).toEqual([]);

    const visibleSelected = toggleVisibleProjectSelection(new Set(['hidden']), [
      'video_1',
      'video_2',
    ]);
    expect([...visibleSelected]).toEqual(['hidden', 'video_1', 'video_2']);
    expect([
      ...toggleVisibleProjectSelection(visibleSelected, ['video_1', 'video_2']),
    ]).toEqual(['hidden']);
  });

  it('parses sort values at the UI boundary', () => {
    expect(parseVideoProjectSort('name-asc')).toBe('name-asc');
    expect(parseVideoProjectSort('unexpected')).toBe('updated-desc');
  });
});

function project(
  id: string,
  name: string,
  template: VideoProjectListItem['template'],
  renderStatus: string,
  updatedAt: string,
): VideoProjectListItem {
  return { id, name, template, renderStatus, updatedAt, hasOutput: false };
}
