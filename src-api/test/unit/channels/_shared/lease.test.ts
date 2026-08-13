import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { DbLeaser } from '@/shared/channels/_shared/db-lease';
import { NopLeaser } from '@/shared/channels/_shared/lease';
import { migration as migration024 } from '@/shared/db/migrations/024_channel_leases';
import { runMigrations } from '@/shared/db/migrations/runner';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db, [migration024]);
  return db;
}

describe('channel leases', () => {
  it('grants nop leases every time', async () => {
    const leaser = new NopLeaser();
    await expect(
      leaser.acquire('channel:telegram:a', 30_000),
    ).resolves.toMatchObject({
      key: 'channel:telegram:a',
    });
  });

  it('prevents another holder from acquiring an active DB lease', async () => {
    const db = createDb();
    const first = new DbLeaser(db, 'holder-a');
    const second = new DbLeaser(db, 'holder-b');

    const lease = await first.acquire('channel:telegram:a', 30_000);
    expect(lease).not.toBeNull();
    await expect(
      second.acquire('channel:telegram:a', 30_000),
    ).resolves.toBeNull();
  });

  it('allows acquire after expiry and supports renew/release', async () => {
    const db = createDb();
    const first = new DbLeaser(db, 'holder-a');
    const second = new DbLeaser(db, 'holder-b');

    const lease = await first.acquire('channel:telegram:a', 1);
    expect(lease).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const replacement = await second.acquire('channel:telegram:a', 30_000);
    expect(replacement).not.toBeNull();
    await expect(second.renew(replacement!)).resolves.toBe(true);
    await second.release(replacement!);
    await expect(
      first.acquire('channel:telegram:a', 30_000),
    ).resolves.not.toBeNull();
  });
});
