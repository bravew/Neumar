import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CloudStorage:SyncMirrorMetrics');

export function logCloudStorageMetric(
  name:
    | 'cloud_storage_local_cache_bytes'
    | 'cloud_storage_change_poll_lag_seconds'
    | 'cloud_storage_content_job_local_failures_total',
  value: number,
  labels: Record<string, string>,
): void {
  logger.info('Cloud storage metric', { name, value, labels });
}
