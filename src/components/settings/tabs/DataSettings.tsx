/**
 * Data Settings - Export, Import, and Clear Data
 */

import { useState } from 'react';

import { useNavigate } from 'react-router-dom';

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';

import { AssetsMaterializationSettings } from '@/components/settings/components/AssetsMaterializationSettings';
import { DataImportPreviewDialog } from '@/components/settings/components/DataImportPreviewDialog';
import { clearQuickstartCache } from '@/components/setup-guard';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { APP_SLUG } from '@/config/branding';
import {
  deleteMessagesByTaskId,
  deleteTask,
  getAllFiles,
  getAllSessions,
  getAllTasks,
  getMessagesByTaskId,
} from '@/shared/db/database';
import {
  clearAllSettings,
  getSettings,
  saveSettingItem,
  type Settings,
} from '@/shared/db/settings';
import { getSessionsDir } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { useDataImport } from './useDataImport';

// Check if running in Tauri environment
function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

interface ExportData {
  version: number;
  exportedAt: string;
  sessions: unknown[];
  tasks: unknown[];
  messages: unknown[];
  files: unknown[];
  settings?: Settings;
}

type OperationStatus = 'idle' | 'loading' | 'success' | 'error';
type ClearType = 'tasks' | 'settings' | 'all' | null;

export function DataSettings() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [exportStatus, setExportStatus] = useState<OperationStatus>('idle');
  const [importStatus, setImportStatus] = useState<OperationStatus>('idle');
  const [clearStatus, setClearStatus] = useState<OperationStatus>('idle');
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [confirmClearType, setConfirmClearType] = useState<ClearType>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const dataImport = useDataImport();

  // Export all data
  const handleExport = async () => {
    setExportStatus('loading');
    setErrorMessage('');

    try {
      // Gather all data
      const sessions = await getAllSessions();
      const tasks = await getAllTasks();
      const files = await getAllFiles();
      const settings = getSettings();

      // Get messages for each task
      const allMessages: unknown[] = [];
      for (const task of tasks) {
        const messages = await getMessagesByTaskId(task.id);
        allMessages.push(...messages);
      }

      const exportData: ExportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions,
        tasks,
        messages: allMessages,
        files,
        settings,
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      const filename = `${APP_SLUG}-backup-${new Date().toISOString().split('T')[0]}.json`;

      // Use Tauri native dialog
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');

      const filePath = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: filename,
      });

      if (filePath) {
        await writeTextFile(filePath, jsonString);
        setExportStatus('success');
        setTimeout(() => setExportStatus('idle'), 2000);
      } else {
        // User cancelled
        setExportStatus('idle');
      }
    } catch (error) {
      if (import.meta.env.DEV)
        console.error('[DataSettings] Export failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Export failed');
      setExportStatus('error');
      setTimeout(() => setExportStatus('idle'), 3000);
    }
  };

  // Import data from file — opens the preview dialog before writing.
  const handleImport = async () => {
    setImportStatus('loading');
    setErrorMessage('');
    await dataImport.pickFile();
    setImportStatus('idle');
    if (dataImport.error) {
      setErrorMessage(dataImport.error);
      setImportStatus('error');
      setTimeout(() => setImportStatus('idle'), 3000);
    }
  };

  // Clear workspace files (sessions directory)
  const clearWorkspaceFiles = async () => {
    if (!isTauri()) return;

    try {
      const sessionsDir = await getSessionsDir();
      const { remove, exists } = await import('@tauri-apps/plugin-fs');

      // Check if sessions directory exists
      const dirExists = await exists(sessionsDir);
      if (dirExists) {
        // Remove the entire sessions directory recursively
        await remove(sessionsDir, { recursive: true });
        if (import.meta.env.DEV)
          console.warn('[DataSettings] Cleared workspace files:', sessionsDir);
      }
    } catch (error) {
      if (import.meta.env.DEV)
        console.warn('[DataSettings] Failed to clear workspace files:', error);
      // Don't throw - continue with database cleanup even if file cleanup fails
    }
  };

  // Clear data
  const handleClear = async (type: ClearType) => {
    if (!type) return;

    setClearStatus('loading');
    setErrorMessage('');
    setShowClearDialog(false);
    setConfirmClearType(null);

    try {
      if (type === 'settings') {
        // Clear settings only
        await clearAllSettings();
      } else if (type === 'tasks') {
        // Clear workspace files first
        await clearWorkspaceFiles();

        // Get all tasks and delete them with their messages
        const tasks = await getAllTasks();
        for (const task of tasks) {
          await deleteMessagesByTaskId(task.id);
          await deleteTask(task.id);
        }
      } else if (type === 'all') {
        // Clear workspace files first
        await clearWorkspaceFiles();

        // Get all tasks and delete them with their messages
        const tasks = await getAllTasks();
        for (const task of tasks) {
          await deleteMessagesByTaskId(task.id);
          await deleteTask(task.id);
        }

        // Clear settings
        await clearAllSettings();
      }

      setClearStatus('success');
      setTimeout(() => {
        setClearStatus('idle');
        // Reload page to reflect changes
        window.location.reload();
      }, 1500);
    } catch (error) {
      if (import.meta.env.DEV)
        console.error('[DataSettings] Clear failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Clear failed');
      setClearStatus('error');
      setTimeout(() => setClearStatus('idle'), 3000);
    }
  };

  // Handle clear option click - show confirmation
  const handleClearOptionClick = (type: ClearType) => {
    setConfirmClearType(type);
  };

  // Get confirmation message based on clear type
  const getConfirmMessage = (type: ClearType): string => {
    switch (type) {
      case 'tasks':
        return t.settings.dataClearTasksConfirm;
      case 'settings':
        return t.settings.dataClearSettingsConfirm;
      case 'all':
        return t.settings.dataClearAllConfirm;
      default:
        return '';
    }
  };

  const getButtonContent = (
    status: OperationStatus,
    icon: React.ReactNode,
    label: string,
    loadingLabel: string,
  ) => {
    if (status === 'loading') {
      return (
        <>
          <AILoadingIndicator size="sm" />
          <span>{loadingLabel}</span>
        </>
      );
    }
    if (status === 'success') {
      return (
        <>
          <CheckCircle2 className="size-4 text-green-500" />
          <span>{t.settings.dataSuccess}</span>
        </>
      );
    }
    return (
      <>
        {icon}
        <span>{label}</span>
      </>
    );
  };

  return (
    <div className="space-y-6">
      {/* Description */}
      <p className="text-muted-foreground text-sm">
        {t.settings.dataDescription}
      </p>

      <AssetsMaterializationSettings />

      {/* Export Data */}
      <div className="border-border rounded-lg border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.dataExport}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.dataExportDescription}
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exportStatus === 'loading'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {getButtonContent(
              exportStatus,
              <Download className="size-4" />,
              t.settings.dataExportButton,
              t.settings.dataExporting,
            )}
          </button>
        </div>
      </div>

      {/* Import Data */}
      <div className="border-border rounded-lg border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.dataImport}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.dataImportDescription}
            </p>
          </div>
          <button
            onClick={handleImport}
            disabled={importStatus === 'loading'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'border-border text-foreground hover:bg-accent border',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {getButtonContent(
              importStatus,
              <Upload className="size-4" />,
              t.settings.dataImportButton,
              t.settings.dataImporting,
            )}
          </button>
        </div>
      </div>

      {/* Re-run Agent Wizard */}
      <div className="border-border rounded-lg border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.quickstartRerun ?? 'Agent Setup Wizard'}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.quickstartRerunDesc ??
                'Re-run the quickstart wizard to create a new agent profile with skills and personality.'}
            </p>
          </div>
          <button
            onClick={async () => {
              await saveSettingItem('quickstart_step', 'template');
              clearQuickstartCache();
              navigate('/quickstart');
            }}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'border-border text-foreground hover:bg-accent border',
            )}
          >
            <Sparkles className="size-4" />
            {t.settings.quickstartRerunButton ?? 'Run Wizard'}
          </button>
        </div>
      </div>

      {/* Clear Data */}
      <div className="border-border rounded-lg border border-red-500/20 bg-red-500/5 p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.dataClear}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.dataClearDescription}
            </p>
          </div>
          <button
            onClick={() => setShowClearDialog(true)}
            disabled={clearStatus === 'loading'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-red-500/10 text-red-500 hover:bg-red-500/20',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {getButtonContent(
              clearStatus,
              <Trash2 className="size-4" />,
              t.settings.dataClearButton,
              t.settings.dataClearing,
            )}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-red-500">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="text-sm">{errorMessage}</span>
        </div>
      )}

      {/* Clear Confirmation Dialog */}
      {showClearDialog && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="border-border bg-background mx-4 w-full max-w-md rounded-xl border p-6 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <AlertTriangle className="size-5" />
              </div>
              <h3 className="text-foreground text-lg font-semibold">
                {t.settings.dataClearConfirmTitle}
              </h3>
            </div>

            <p className="text-muted-foreground mb-6 text-sm">
              {t.settings.dataClearConfirmDescription}
            </p>

            <div className="space-y-3">
              <button
                onClick={() => handleClearOptionClick('tasks')}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors',
                  'border-border hover:bg-accent border',
                )}
              >
                <div>
                  <div className="text-foreground font-medium">
                    {t.settings.dataClearTasksOnly}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t.settings.dataClearTasksOnlyDescription}
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleClearOptionClick('settings')}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors',
                  'border-border hover:bg-accent border',
                )}
              >
                <div>
                  <div className="text-foreground font-medium">
                    {t.settings.dataClearSettingsOnly}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t.settings.dataClearSettingsOnlyDescription}
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleClearOptionClick('all')}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors',
                  'border border-red-500/30 bg-red-500/5 hover:bg-red-500/10',
                )}
              >
                <div>
                  <div className="font-medium text-red-500">
                    {t.settings.dataClearAll}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t.settings.dataClearAllDescription}
                  </div>
                </div>
              </button>
            </div>

            <button
              onClick={() => setShowClearDialog(false)}
              className="text-muted-foreground hover:text-foreground mt-4 w-full py-2 text-center text-sm transition-colors"
            >
              {t.settings.dataCancel}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmClearType && (
        <div className="bg-background/80 fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm">
          <div className="border-border bg-background mx-4 w-full max-w-md rounded-xl border p-6 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <AlertTriangle className="size-5" />
              </div>
              <h3 className="text-foreground text-lg font-semibold">
                {t.settings.dataConfirmTitle}
              </h3>
            </div>

            <p className="text-muted-foreground mb-6 text-sm">
              {getConfirmMessage(confirmClearType)}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmClearType(null)}
                className={cn(
                  'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  'border-border text-foreground hover:bg-accent border',
                )}
              >
                {t.settings.dataCancel}
              </button>
              <button
                onClick={() => handleClear(confirmClearType)}
                className={cn(
                  'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  'bg-red-500 text-white hover:bg-red-600',
                )}
              >
                {t.settings.dataConfirmClear}
              </button>
            </div>
          </div>
        </div>
      )}

      <DataImportPreviewDialog
        open={dataImport.dialogOpen}
        onOpenChange={dataImport.setDialogOpen}
        payload={dataImport.payload}
        result={dataImport.result}
        busy={dataImport.busy}
        onConfirm={dataImport.confirm}
      />
    </div>
  );
}
