import { describe, expect, it } from 'vitest';

import {
  CATEGORY_TO_LOCATION,
  SETTINGS_PAGE_IDS,
  resolveSettingsLocation,
} from '@/components/settings/navigation';
import {
  SETTINGS_CATEGORIES,
  type SettingsCategory,
} from '@/components/settings/types';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

describe('settings category map', () => {
  it('gives every settings category a page', () => {
    for (const category of SETTINGS_CATEGORIES) {
      const location = resolveSettingsLocation(category);
      expect(SETTINGS_PAGE_IDS).toContain(location.page);
      expect(location.searchKeys.length).toBeGreaterThan(0);
      expect(CATEGORY_TO_LOCATION[category]).toBe(location);
    }
  });

  it('resolves every open-settings detail used in src', () => {
    const details = openSettingsDetails(path.resolve('src'));
    expect(details).toEqual(
      expect.arrayContaining(['keyboard', 'skills', 'mcp', 'connector']),
    );
    for (const detail of details) {
      expect(SETTINGS_CATEGORIES).toContain(detail);
      expect(
        resolveSettingsLocation(detail as SettingsCategory).page,
      ).toBeTruthy();
    }
  });
});

function openSettingsDetails(root: string): string[] {
  const found = new Set<string>();
  for (const file of walk(root)) {
    if (!/\.(ts|tsx)$/.test(file) || file.includes('__tests__')) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /open-settings[\s\S]{0,120}?detail:\s*'([^']+)'/g,
    )) {
      if (match[1]) found.add(match[1]);
    }
    for (const match of text.matchAll(/openSettings\(\s*'([^']+)'/g)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found].sort();
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}
