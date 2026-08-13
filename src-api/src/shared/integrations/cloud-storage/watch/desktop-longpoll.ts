import { setTimeout as delay } from 'timers/promises';

import type { CloudStorageAdapter } from '../adapter';
import { cloudStorageRegistry } from '../registry';
import type { CloudStorageProvider } from '../types';

export interface LongpollConnection {
  id: string;
  provider: CloudStorageProvider;
  wakeupMode?: 'webhook' | 'longpoll' | 'poll';
  cursor?: string;
}

export async function runDesktopLongpollOnce(
  connection: LongpollConnection,
): Promise<'slept' | 'polled'> {
  if (connection.wakeupMode === 'webhook') {
    await delay(0);
    return 'slept';
  }

  const adapter = cloudStorageRegistry.resolve(
    connection.id,
  ) as CloudStorageAdapter;
  if (adapter.getChanges) {
    await adapter.getChanges({ cursor: connection.cursor });
  }
  return 'polled';
}
