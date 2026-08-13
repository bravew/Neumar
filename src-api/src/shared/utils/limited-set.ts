/**
 * Bounded Set
 *
 * A Set with a maximum size that evicts the oldest entry when full.
 * Drop-in replacement for Set<T> with bounded memory usage.
 * Uses Map insertion order for O(1) oldest-first eviction.
 */
export class LimitedSet<T> {
  private items = new Set<T>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  add(item: T): void {
    if (this.items.size >= this.maxSize && !this.items.has(item)) {
      // Evict oldest entry (first in iteration order)
      const oldest = this.items.values().next().value;
      if (oldest !== undefined) {
        this.items.delete(oldest);
      }
    }
    this.items.add(item);
  }

  has(item: T): boolean {
    return this.items.has(item);
  }

  delete(item: T): boolean {
    return this.items.delete(item);
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}
