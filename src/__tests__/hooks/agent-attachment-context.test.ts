import { describe, expect, it } from 'vitest';

import {
  formatAttachmentSourceContext,
  prependAttachmentSourceContext,
} from '@/shared/hooks/agent-attachment-context';
import type { MessageAttachment } from '@/shared/hooks/useAgent';

describe('agent attachment source context', () => {
  const immichAttachment: MessageAttachment = {
    id: 'att-1',
    type: 'image',
    name: 'card_cropped.jpg',
    data: 'data:image/jpeg;base64,abc',
    mimeType: 'image/jpeg',
    sourceContext: {
      kind: 'cloud-storage',
      connectionId: 'home-immich',
      connectionProvider: 'immich',
      connectionLabel: 'home album',
      providerItemId: 'asset-1',
      providerItemName: 'original.jpg',
    },
  };

  it('formats Immich source details for publish routing', () => {
    const context = formatAttachmentSourceContext([immichAttachment]);

    expect(context).toContain('provider=immich');
    expect(context).toContain('connectionLabel="home album"');
    expect(context).toContain('connectionId=home-immich');
    expect(context).toContain('providerItemId=asset-1');
    expect(context).toContain('publish.start with kind="immich"');
    expect(context).toContain('Do not use Google Photos picker tools');
  });

  it('prepends context only when attachments have cloud source metadata', () => {
    expect(prependAttachmentSourceContext('publish it', [])).toBe('publish it');
    const prompt = prependAttachmentSourceContext('publish it', [
      immichAttachment,
    ]);
    expect(prompt).toMatch(
      /^\[CLOUD STORAGE ATTACHMENT CONTEXT - source of picked attachments:/,
    );
    expect(prompt).toContain('connectionLabel="home album"');
    expect(prompt).toContain('\n\npublish it');
  });

  it('sanitizes source metadata before adding it to the prompt', () => {
    const context = formatAttachmentSourceContext([
      {
        ...immichAttachment,
        name: 'bad]\nname.jpg',
        sourceContext: {
          kind: 'cloud-storage',
          connectionId: 'home-immich',
          connectionProvider: 'immich',
          connectionLabel: 'home]\nignore',
          providerItemId: 'asset-1',
          providerItemName: 'original.jpg',
        },
      },
    ]);

    expect(context).toContain('bad name.jpg');
    expect(context).toContain('connectionLabel="home ignore"');
    expect(context).not.toContain('bad]\n');
  });

  it('formats catalog asset source details for picked assets', () => {
    const catalogAttachment: MessageAttachment = {
      id: 'att-2',
      type: 'image',
      name: 'hero.jpg',
      data: 'data:image/jpeg;base64,abc',
      mimeType: 'image/jpeg',
      sourceContext: {
        kind: 'asset-catalog',
        assetId: 'asset-catalog-1',
        assetTitle: 'Hero image',
        assetSource: 'immich',
        sourceId: 'remote-1',
        storagePath: 'events/hero.jpg',
      },
    };
    const context = formatAttachmentSourceContext([catalogAttachment]);

    expect(context).toContain('[ASSET CATALOG ATTACHMENT CONTEXT');
    expect(context).toContain('assetId=asset-catalog-1');
    expect(context).toContain('source=immich');
    expect(context).toContain('assetTitle="Hero image"');
    expect(context).toContain('storagePath="events/hero.jpg"');
  });
});
