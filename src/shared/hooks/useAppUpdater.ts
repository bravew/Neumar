// Re-export from provider — all consumers share a single instance via AppUpdaterProvider
export {
  useAppUpdater,
  AppUpdaterProvider,
  type AppUpdaterValue,
  type UpdateStatus,
} from '@/shared/providers/app-updater-provider';
