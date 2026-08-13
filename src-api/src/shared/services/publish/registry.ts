import { ImmichPublishDestination } from './destinations/immich-destination';
import { LocalArchiveAdapter } from './destinations/local-archive';
import { NativeCloudPublishDestination } from './destinations/native-cloud-destination';
import type { DestinationKind, PublishDestinationAdapter } from './types';

export class PublishDestinationRegistry {
  private readonly adapters = new Map<
    DestinationKind,
    PublishDestinationAdapter
  >();

  register(adapter: PublishDestinationAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  unregister(kind: DestinationKind): void {
    this.adapters.delete(kind);
  }

  clear(): void {
    this.adapters.clear();
  }

  has(kind: DestinationKind): boolean {
    return this.adapters.has(kind);
  }

  resolve(kind: DestinationKind): PublishDestinationAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`No publish destination adapter registered for ${kind}`);
    }
    return adapter;
  }

  list(): PublishDestinationAdapter[] {
    return [...this.adapters.values()];
  }
}

export function createDefaultPublishRegistry(): PublishDestinationRegistry {
  const registry = new PublishDestinationRegistry();
  registry.register(new LocalArchiveAdapter());
  registry.register(new ImmichPublishDestination());
  registry.register(new NativeCloudPublishDestination({ kind: 'box' }));
  registry.register(new NativeCloudPublishDestination({ kind: 'dropbox' }));
  registry.register(new NativeCloudPublishDestination({ kind: 'onedrive' }));
  return registry;
}

export const publishDestinationRegistry = createDefaultPublishRegistry();
