import { describe, expect, it } from 'vitest';

import { kenBurnsFilter } from '@/shared/video/pipeline';

describe('kenBurnsFilter', () => {
  it('builds an explicit no-op zoompan filter', () => {
    expect(
      kenBurnsFilter({ kind: 'image-pan', assetId: 'asset-1' }, 2, {
        width: 1920,
        height: 1080,
      }),
    ).toMatchInlineSnapshot(
      `"zoompan=z='1+(0)*(on/59)':x='iw*(0.500000+(0)*(on/59))-(iw/zoom/2)':y='ih*(0.500000+(0)*(on/59))-(ih/zoom/2)':d=60:s=1920x1080:fps=30"`,
    );
  });

  it('builds a smooth zoom between normalized rectangles', () => {
    expect(
      kenBurnsFilter(
        {
          kind: 'image-pan',
          assetId: 'asset-1',
          kenBurns: {
            from: { x: 0, y: 0, width: 1, height: 1 },
            to: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
          },
        },
        3,
        { width: 1080, height: 1920 },
      ),
    ).toMatchInlineSnapshot(
      `"zoompan=z='1+(0.666667)*(on/89)':x='iw*(0.500000+(0)*(on/89))-(iw/zoom/2)':y='ih*(0.500000+(0)*(on/89))-(ih/zoom/2)':d=90:s=1080x1920:fps=30"`,
    );
  });
});
