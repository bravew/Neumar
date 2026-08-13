/**
 * Collect all values from an async generator into an array.
 */
export async function collectAsyncGen<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

/**
 * Parse raw SSE text into an array of data payloads.
 */
export function parseSSEText(text: string): unknown[] {
  const events: unknown[] = [];
  for (const chunk of text.split('\n\n').filter(Boolean)) {
    if (chunk.startsWith('data: ')) {
      try {
        events.push(JSON.parse(chunk.slice(6)));
      } catch {
        // skip malformed
      }
    }
  }
  return events;
}

interface SSEEvent {
  event?: string;
  data: unknown;
}

/**
 * Collect SSE events from a fetch Response object.
 * Reads the full body, splits on double-newline boundaries,
 * and parses `event:` + `data:` lines from each block.
 */
export async function collectSSEFromResponse(
  res: Response,
  opts?: { maxEvents?: number },
): Promise<SSEEvent[]> {
  const maxEvents = opts?.maxEvents ?? Infinity;
  const text = await res.text();
  const blocks = text.split('\n\n').filter(Boolean);
  const events: SSEEvent[] = [];

  for (const block of blocks) {
    if (events.length >= maxEvents) break;

    const lines = block.split('\n');
    let eventType: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6));
      }
    }

    if (dataLines.length > 0) {
      const raw = dataLines.join('\n');
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
      events.push({ event: eventType, data });
    }
  }

  return events;
}

/**
 * Assert that a Response has proper SSE headers.
 */
export function assertSSEHeaders(res: Response) {
  const contentType = res.headers.get('content-type') ?? '';
  const cacheControl = res.headers.get('cache-control') ?? '';

  if (!contentType.includes('text/event-stream')) {
    throw new Error(
      `Expected content-type to contain 'text/event-stream', got '${contentType}'`,
    );
  }
  if (!cacheControl.includes('no-cache')) {
    throw new Error(
      `Expected cache-control to contain 'no-cache', got '${cacheControl}'`,
    );
  }
}
