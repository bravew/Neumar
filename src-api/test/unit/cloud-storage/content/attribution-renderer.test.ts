import { describe, expect, it } from 'vitest';

import {
  appendAttribution,
  renderAttribution,
} from '@/shared/integrations/cloud-storage/content/attribution-renderer';
import type { LicenseInfo } from '@/shared/integrations/cloud-storage/types';

const licenseInfo: LicenseInfo = {
  provider: 'Unsplash',
  creatorName: 'Jane Smith',
  attributionUrl:
    'https://unsplash.com/photos/abc?utm_source=neuma&utm_medium=referral',
  license: 'unsplash',
  licenseUrl: 'https://unsplash.com/license',
};

describe('attribution renderer', () => {
  it('renders markdown attribution with source and license links', () => {
    expect(renderAttribution(licenseInfo, 'markdown')).toBe(
      '[Photo by Jane Smith on Unsplash](https://unsplash.com/photos/abc?utm_source=neuma&utm_medium=referral) ([unsplash](https://unsplash.com/license))',
    );
  });

  it('renders plain text attribution without dropping source facts', () => {
    expect(renderAttribution(licenseInfo, 'text')).toBe(
      'Photo by Jane Smith on Unsplash (unsplash)',
    );
  });

  it('escapes html attribution links', () => {
    expect(
      renderAttribution(
        {
          provider: 'OpenVerse',
          creatorName: '<Jane>',
          attributionUrl: 'https://example.com/?q="x"',
        },
        'html',
      ),
    ).toBe(
      '<a href="https://example.com/?q=&quot;x&quot;" rel="nofollow noopener noreferrer">Photo by &lt;Jane&gt; on OpenVerse</a>',
    );
  });

  it('appends attribution to generated content', () => {
    expect(appendAttribution('Caption', licenseInfo, 'text')).toBe(
      'Caption\n\nPhoto by Jane Smith on Unsplash (unsplash)',
    );
  });
});
