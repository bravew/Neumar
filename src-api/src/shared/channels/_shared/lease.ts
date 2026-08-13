export interface LeaseHandle {
  key: string;
  holder: string;
  ttlMs: number;
  expiresAt: number;
}

export interface Leaser {
  acquire(key: string, ttlMs: number): Promise<LeaseHandle | null>;
  renew(handle: LeaseHandle): Promise<boolean>;
  release(handle: LeaseHandle): Promise<void>;
}

export class NopLeaser implements Leaser {
  private readonly holder = 'nop';

  async acquire(key: string, ttlMs: number): Promise<LeaseHandle> {
    return {
      key,
      holder: this.holder,
      ttlMs,
      expiresAt: Date.now() + ttlMs,
    };
  }

  async renew(handle: LeaseHandle): Promise<boolean> {
    handle.expiresAt = Date.now() + handle.ttlMs;
    return true;
  }

  async release(_handle: LeaseHandle): Promise<void> {
    // Single-instance default has nothing to release.
  }
}
