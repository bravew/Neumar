import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  exportAsImage,
  requestPreviewSnapshot,
  sanitizePngFilename,
} from '@/components/artifacts/live/preview-snapshot';

describe('preview snapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves matching snapshot responses from the preview frame', async () => {
    const target = {
      postMessage: vi.fn((message: { requestId: string }) => {
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              source: target as unknown as MessageEventSource,
              data: {
                payload: {
                  kind: 'neuma-preview-snapshot',
                  requestId: message.requestId,
                  dataUrl: 'data:image/png;base64,AAA=',
                  width: 320,
                  height: 180,
                },
              },
            }),
          );
        });
      }),
    };
    const iframe = {} as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: target });

    await expect(requestPreviewSnapshot(iframe)).resolves.toEqual({
      dataUrl: 'data:image/png;base64,AAA=',
      width: 320,
      height: 180,
    });
  });

  it('sanitizes filenames and triggers a PNG download', async () => {
    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = document.createElementNS(
        'http://www.w3.org/1999/xhtml',
        tagName,
      ) as HTMLElement;
      if (tagName === 'a') {
        Object.defineProperty(element, 'click', { value: click });
      }
      return element;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const pngBlob = new Blob(['x'], { type: 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => pngBlob }) as unknown as Response),
    );

    await exportAsImage('bad/name', {
      dataUrl: 'data:image/png;base64,AAA=',
      width: 1,
      height: 1,
    });

    expect(sanitizePngFilename('bad/name')).toBe('bad-name.png');
    expect(click).toHaveBeenCalled();
  });
});
