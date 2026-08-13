import Database from 'better-sqlite3';

import { migration as migration019 } from '../../src/shared/db/migrations/019_publish_tables';
import { runMigrations } from '../../src/shared/db/migrations/runner';
import { JobLedger } from '../../src/shared/services/publish/job-ledger';

const [, , dbPath, legId] = process.argv;

if (!dbPath || !legId) {
  throw new Error('Usage: publish-offset-child <dbPath> <legId>');
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
runMigrations(db, [migration019]);

const ledger = new JobLedger({ db });
ledger.recordChunkProgress(legId, 1_048_576, ['etag-1']);

db.close();
process.exit(0);
