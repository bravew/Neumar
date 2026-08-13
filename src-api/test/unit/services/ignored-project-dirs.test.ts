import { describe, expect, it } from 'vitest';

import {
  isIgnoredProjectDirName,
  pathHasIgnoredProjectDir,
} from '@/shared/services/design-mode/ignored-project-dirs';

describe('DesignMode ignored project directories', () => {
  it('excludes generated and installed directories', () => {
    expect(isIgnoredProjectDirName('node_modules')).toBe(true);
    expect(isIgnoredProjectDirName('dist')).toBe(true);
    expect(isIgnoredProjectDirName('.live-artifacts')).toBe(true);
    expect(isIgnoredProjectDirName('DerivedData-cache')).toBe(true);
    expect(isIgnoredProjectDirName('src')).toBe(false);
  });

  it('detects ignored segments in produced file paths', () => {
    expect(pathHasIgnoredProjectDir('/workspace/app/dist/screenshot.png')).toBe(
      true,
    );
    expect(pathHasIgnoredProjectDir('/workspace/app/src/screenshot.png')).toBe(
      false,
    );
  });
});
