import { describe, expect, it } from 'vitest';

import {
  editorLocationParams,
  parseEditorLocation,
} from '@/components/video/editorLocation';
import type { VideoEditorStep } from '@/components/video/editorTypes';

const parse = (search: string, derived: VideoEditorStep = 'brief') =>
  parseEditorLocation(new URLSearchParams(search), derived);

describe('editor location', () => {
  it('falls back to the derived step when the link names none', () => {
    expect(parse('', 'generate')).toEqual({
      step: 'generate',
      rail: null,
      view: null,
      html: false,
    });
  });

  it('reads each key independently', () => {
    expect(parse('step=brief&rail=assets')).toMatchObject({
      step: 'brief',
      rail: 'assets',
    });
    expect(parse('step=preview&view=output')).toMatchObject({
      step: 'preview',
      view: 'output',
    });
    expect(parse('step=brief&html=1').html).toBe(true);
  });

  it('drops values no control could undo', () => {
    // An unknown rail tab would open nothing; honouring it would strand the
    // rail on a tab with no content.
    expect(parse('step=brief&rail=nonsense').rail).toBeNull();
    expect(parse('step=brief&step=bogus').step).toBe('brief');
    // `view` outside Preview has no meaning and no control to change it.
    expect(parse('step=generate&view=output').view).toBeNull();
  });

  describe('canonical params', () => {
    it('writes one representation per screen', () => {
      const params = editorLocationParams({
        step: 'brief',
        rail: 'assets',
        view: null,
        html: false,
      });
      expect(params.toString()).toBe('step=brief&rail=assets');
    });

    it('clears keys that carry no information at this location', () => {
      const params = editorLocationParams(
        { step: 'generate', rail: null, view: null, html: false },
        new URLSearchParams('rail=assets&view=output&html=1'),
      );
      expect(params.toString()).toBe('step=generate');
    });

    it('keeps unrelated query keys', () => {
      const params = editorLocationParams(
        { step: 'brief', rail: null, view: null, html: false },
        new URLSearchParams('legacy=1'),
      );
      expect(params.get('legacy')).toBe('1');
    });
  });
});
