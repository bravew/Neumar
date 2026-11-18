/**
 * A pull-based view of an agent message stream that a run can stop reading
 * from and a later run can continue, without losing or repeating a message.
 *
 * A pull that is in flight when the reader pauses is not consumed: its result
 * is delivered to whichever reader calls `pull()` next. Closing the source does
 * not wait, because a pull blocked on a paused agent resolves only when that
 * agent ends.
 */
export class PausableSource<T> {
  private readonly iterator: AsyncIterator<T>;
  private inFlight: Promise<IteratorResult<T>> | null = null;

  constructor(source: AsyncIterable<T>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  /** The next result. Repeated calls before `settle()` share one pull. */
  pull(): Promise<IteratorResult<T>> {
    if (!this.inFlight) {
      const pulled = this.iterator.next();
      // A paused reader may never await this pull; keep a rejection from
      // surfacing as unhandled. A later reader still receives the rejection.
      pulled.catch(() => undefined);
      this.inFlight = pulled;
    }
    return this.inFlight;
  }

  /** Marks the pulled result as consumed; the next pull starts a new one. */
  settle(): void {
    this.inFlight = null;
  }

  /** Ends the source without waiting for a pull that is still in flight. */
  close(): void {
    this.inFlight = null;
    const closing = this.iterator.return?.(undefined);
    closing?.catch(() => undefined);
  }
}
