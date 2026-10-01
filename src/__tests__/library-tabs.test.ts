import { describe, expect, it } from 'vitest';

import { libraryTabRedirect } from '@/app/pages/library-tabs';

describe('libraryTabRedirect', () => {
  it('leaves the flag-off library on the requested tab', () => {
    expect(libraryTabRedirect('plugins', false)).toBeNull();
    expect(libraryTabRedirect('marketplace', false)).toBeNull();
    expect(libraryTabRedirect('publish', false)).toBeNull();
    expect(libraryTabRedirect('cloud-storage', false)).toBeNull();
    expect(libraryTabRedirect('graph', false)).toBeNull();
  });

  it('sends each old tab value to its new home when the simple shell is on', () => {
    expect(libraryTabRedirect('plugins', true)).toEqual({
      kind: 'settings',
      category: 'skills',
    });
    expect(libraryTabRedirect('marketplace', true)).toEqual({
      kind: 'settings',
      category: 'plugins',
    });
    expect(libraryTabRedirect('publish', true)).toEqual({
      kind: 'settings',
      category: 'publish',
    });
    expect(libraryTabRedirect('cloud-storage', true)).toEqual({
      kind: 'tab',
      tab: 'files',
    });
    expect(libraryTabRedirect('graph', true)).toBeNull();
    expect(libraryTabRedirect('tasks', true)).toBeNull();
  });
});
