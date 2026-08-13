import { describe, expect, it } from 'vitest';

import {
  formatEdlTimecode,
  formatFcpTime,
  msToFrames,
} from '@/shared/video/editor-handoff/rational-time';
import {
  escapeXmlAttr,
  escapeXmlText,
} from '@/shared/video/editor-handoff/xml';

describe('editor handoff rational time and XML helpers', () => {
  it('rounds milliseconds to frame-accurate time values', () => {
    expect(msToFrames(1000, 24)).toBe(24);
    expect(formatFcpTime(1000, 24)).toBe('1s');
    expect(formatFcpTime(1000 / 24, 24)).toBe('1/24s');
    expect(formatEdlTimecode(3661000, 30)).toBe('01:01:01:00');
  });

  it('escapes XML text and attributes without dropping unicode', () => {
    expect(escapeXmlText('A & <B> 雪')).toBe('A &amp; &lt;B&gt; 雪');
    expect(escapeXmlAttr('"quoted" & <tag>')).toBe(
      '&quot;quoted&quot; &amp; &lt;tag&gt;',
    );
  });
});
