/**
 * SSE Edge Case Tests
 *
 * Tests the SSE stream parsing and helper utilities for correctness
 * with edge cases: multi-line data, named events, empty events,
 * large payloads, and malformed input.
 *
 * Best practices:
 * - Test parsers with boundary inputs (empty, huge, malformed)
 * - Test the actual helper functions used in production tests
 * - No server spawn needed — these are pure function tests
 */
import { describe, expect, it } from 'vitest';

import {
  collectAsyncGen,
  collectSSEFromResponse,
  assertSSEHeaders,
  parseSSEText,
} from '../helpers/stream';

describe('SSE Parsing Edge Cases', () => {
  // ---- parseSSEText ----

  describe('parseSSEText', () => {
    it('parses standard single-line data events', () => {
      const text = 'data: {"type":"hello"}\n\ndata: {"type":"world"}\n\n';
      const events = parseSSEText(text);
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'hello' });
      expect(events[1]).toEqual({ type: 'world' });
    });

    it('handles empty input', () => {
      expect(parseSSEText('')).toEqual([]);
    });

    it('skips malformed JSON gracefully', () => {
      const text = 'data: {invalid json}\n\ndata: {"valid":true}\n\n';
      const events = parseSSEText(text);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ valid: true });
    });

    it('handles events without data: prefix', () => {
      const text = 'event: heartbeat\n\n';
      const events = parseSSEText(text);
      expect(events).toHaveLength(0); // no data: line
    });

    it('parses large JSON payloads', () => {
      const largeObj = { data: 'x'.repeat(100_000) };
      const text = `data: ${JSON.stringify(largeObj)}\n\n`;
      const events = parseSSEText(text);
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, string>).data).toHaveLength(100_000);
    });

    it('handles rapid sequential events', () => {
      const events = Array.from(
        { length: 100 },
        (_, i) => `data: {"seq":${i}}\n\n`,
      ).join('');
      const parsed = parseSSEText(events);
      expect(parsed).toHaveLength(100);
      expect((parsed[99] as Record<string, number>).seq).toBe(99);
    });

    it('handles trailing newlines', () => {
      const text = 'data: {"ok":true}\n\n\n\n\n';
      const events = parseSSEText(text);
      expect(events).toHaveLength(1);
    });
  });

  // ---- collectSSEFromResponse ----

  describe('collectSSEFromResponse', () => {
    function makeSSEResponse(body: string): Response {
      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    }

    it('collects events from response body', async () => {
      const body = 'data: {"type":"start"}\n\ndata: {"type":"end"}\n\n';
      const events = await collectSSEFromResponse(makeSSEResponse(body));
      expect(events).toHaveLength(2);
      expect(events[0]!.data).toEqual({ type: 'start' });
    });

    it('parses named events (event: field)', async () => {
      const body = 'event: error\ndata: {"msg":"fail"}\n\n';
      const events = await collectSSEFromResponse(makeSSEResponse(body));
      expect(events).toHaveLength(1);
      expect(events[0]!.event).toBe('error');
      expect(events[0]!.data).toEqual({ msg: 'fail' });
    });

    it('handles multi-line data fields', async () => {
      const body = 'data: line1\ndata: line2\n\n';
      const events = await collectSSEFromResponse(makeSSEResponse(body));
      expect(events).toHaveLength(1);
      // Multi-line data joined with newline
      expect(events[0]!.data).toBe('line1\nline2');
    });

    it('respects maxEvents limit', async () => {
      const body = 'data: {"a":1}\n\ndata: {"a":2}\n\ndata: {"a":3}\n\n';
      const events = await collectSSEFromResponse(makeSSEResponse(body), {
        maxEvents: 2,
      });
      expect(events).toHaveLength(2);
    });

    it('handles empty response', async () => {
      const events = await collectSSEFromResponse(makeSSEResponse(''));
      expect(events).toHaveLength(0);
    });

    it('handles retry directive (ignored in parsing)', async () => {
      const body = 'retry: 3000\ndata: {"ok":true}\n\n';
      const events = await collectSSEFromResponse(makeSSEResponse(body));
      expect(events).toHaveLength(1);
    });
  });

  // ---- assertSSEHeaders ----

  describe('assertSSEHeaders', () => {
    it('passes for valid SSE headers', () => {
      const res = new Response('', {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
      expect(() => assertSSEHeaders(res)).not.toThrow();
    });

    it('throws for wrong content-type', () => {
      const res = new Response('', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(() => assertSSEHeaders(res)).toThrow('text/event-stream');
    });

    it('throws for missing cache-control', () => {
      const res = new Response('', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
      expect(() => assertSSEHeaders(res)).toThrow('no-cache');
    });
  });

  // ---- collectAsyncGen ----

  describe('collectAsyncGen', () => {
    it('collects all items from async generator', async () => {
      async function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }
      const items = await collectAsyncGen(gen());
      expect(items).toEqual([1, 2, 3]);
    });

    it('handles empty generator', async () => {
      async function* gen() {
        // empty
      }
      const items = await collectAsyncGen(gen());
      expect(items).toEqual([]);
    });

    it('handles generator that yields objects', async () => {
      async function* gen() {
        yield { type: 'text', content: 'hello' };
        yield { type: 'done' };
      }
      const items = await collectAsyncGen(gen());
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ type: 'text', content: 'hello' });
    });
  });
});
