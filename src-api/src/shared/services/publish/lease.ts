export interface ResourceLockOptions {
  leaseMs?: number;
}

export class ResourceLockManager {
  private readonly locks = new Map<string, Promise<void>>();

  async withResourceLock<T>(
    key: string,
    fn: () => Promise<T>,
    _options: ResourceLockOptions = {},
  ): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    this.locks.set(key, current);

    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}

export const publishResourceLocks = new ResourceLockManager();
