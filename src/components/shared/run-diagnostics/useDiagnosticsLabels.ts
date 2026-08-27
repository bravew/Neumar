import { useLanguage } from '@/shared/providers/language-provider';

export function useDiagnosticsLabels() {
  const { t } = useLanguage();
  return {
    title: t.task.runDiagnosticsTitle,
    partial: t.task.runDiagnosticsPartial,
    timing: t.task.runDiagnosticsTiming,
    tools: t.task.runDiagnosticsTools,
    environment: t.task.runDiagnosticsEnvironment,
    usage: t.task.runDiagnosticsUsage,
    delivery: t.task.runDiagnosticsDelivery,
    unavailable: t.task.runDiagnosticsUnavailable,
    attempts: t.task.runDiagnosticsAttempts,
    continuations: t.task.runDiagnosticsContinuations,
    files: t.task.runDiagnosticsFiles,
    recovery: t.task.runDiagnosticsRecovery,
    loading: t.task.runDiagnosticsLoading,
    failedLoad: t.task.runDiagnosticsFailedLoad,
    exportBundle: t.task.runDiagnosticsExportBundle,
    exportingBundle: t.task.runDiagnosticsExportingBundle,
    exportFailed: t.task.runDiagnosticsExportFailed,
  };
}
