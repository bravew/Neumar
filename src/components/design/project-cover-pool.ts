interface QueueEntry {
  signal: AbortSignal;
  started: boolean;
  onAbort: () => void;
  start: () => void;
  cancel: () => void;
}

function abortError(): DOMException {
  return new DOMException('Project cover discovery aborted', 'AbortError');
}

export class ProjectCoverDiscoveryPool {
  private readonly queue: QueueEntry[] = [];
  private active = 0;
  private pumpScheduled = false;

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Project cover concurrency limit must be positive');
    }
  }

  get activeCount(): number {
    return this.active;
  }

  schedule<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        signal,
        started: false,
        onAbort: () => {
          if (entry.started) return;
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          signal.removeEventListener('abort', entry.onAbort);
          reject(abortError());
        },
        start: () => {
          entry.started = true;
          this.active += 1;
          void work()
            .then(resolve, reject)
            .finally(() => {
              signal.removeEventListener('abort', entry.onAbort);
              this.active -= 1;
              this.schedulePump();
            });
        },
        cancel: () => reject(abortError()),
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
      this.queue.push(entry);
      this.schedulePump();
    });
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.limit) {
      const entry = this.queue.shift();
      if (!entry) return;
      if (entry.signal.aborted) {
        entry.signal.removeEventListener('abort', entry.onAbort);
        entry.cancel();
        continue;
      }
      entry.start();
    }
  }
}

const projectCoverDiscoveryPool = new ProjectCoverDiscoveryPool(6);

export function scheduleProjectCoverDiscovery<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  return projectCoverDiscoveryPool.schedule(signal, work);
}
