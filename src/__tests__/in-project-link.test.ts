import { describe, expect, it } from 'vitest';

import {
  decodeInProjectLinkHref,
  encodeInProjectLinkHref,
  resolveInProjectLink,
} from '@/shared/lib/in-project-link';

describe('resolveInProjectLink', () => {
  it('accepts relative project file paths and normalizes dot segments', () => {
    expect(resolveInProjectLink('./artifacts/../artifacts/index.html')).toBe(
      'artifacts/index.html',
    );
    expect(resolveInProjectLink('assets/hero.png?version=1#preview')).toBe(
      'assets/hero.png',
    );
  });

  it('rejects external, absolute, traversal, and extensionless links', () => {
    expect(resolveInProjectLink('https://example.com/file.html')).toBeNull();
    expect(resolveInProjectLink('/artifacts/index.html')).toBeNull();
    expect(resolveInProjectLink('../outside.html')).toBeNull();
    expect(resolveInProjectLink('docs/readme')).toBeNull();
  });

  it('can restrict links to known project paths', () => {
    expect(
      resolveInProjectLink('artifacts/index.html', ['artifacts/index.html']),
    ).toBe('artifacts/index.html');
    expect(resolveInProjectLink('artifacts/missing.html', [])).toBeNull();
  });

  it('round-trips sanitized project file link hrefs', () => {
    const href = encodeInProjectLinkHref('artifacts/index.html');
    expect(href).toBe('#neuma-project-file=artifacts%2Findex.html');
    expect(decodeInProjectLinkHref(href, ['artifacts/index.html'])).toBe(
      'artifacts/index.html',
    );
    expect(
      decodeInProjectLinkHref(
        'https://example.com/#neuma-project-file=artifacts%2Findex.html',
      ),
    ).toBeNull();
  });
});
