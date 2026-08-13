// Must run before @ag-ui/client / @copilotkit code captures `window.fetch`.
import '@/shared/lib/fetch-bind-polyfill';
import React from 'react';

import { RouterProvider } from 'react-router-dom';

import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { Toaster } from 'sonner';

import { PetWindowPage } from './app/pages/PetWindow';
import { TeleprompterPage } from './app/pages/Teleprompter';
import { router } from './app/router';
import {
  isPetWindowLocation,
  PET_WINDOW_QUERY_VALUE,
} from './components/pets/tauriPetWindow';
import { initWorkspaces } from './components/workspace/register';
import { getSettingsAsync, initializeSettings } from './shared/db/settings';
import {
  isTeleprompterLocation,
  TELEPROMPTER_WINDOW_QUERY_VALUE,
} from './shared/lib/teleprompter';
import { startWorkspaceWatcher } from './shared/lib/workspace-watcher';
import { AppUpdaterProvider } from './shared/providers/app-updater-provider';
import { LanguageProvider } from './shared/providers/language-provider';
import { ThemeProvider } from './shared/providers/theme-provider';
import '@/config/style/global.css';

import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';

const TOAST_DURATION_MS = 4_000;

// Prevent browser/webview default of navigating to dropped files.
// Without this, dropping a file anywhere outside the ChatInput replaces the entire app.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

function ErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: unknown;
  resetErrorBoundary: () => void;
}) {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  return (
    <div className="flex min-h-svh flex-col items-center justify-center p-8 text-center font-sans">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-[#888]">{message}</p>
      <button
        onClick={resetErrorBoundary}
        className="mt-4 cursor-pointer border-none bg-transparent text-sm text-indigo-500 underline"
      >
        Try again
      </button>
    </div>
  );
}

// Initialize workspaces (synchronous — just registers components)
initWorkspaces();

const isPetWindow = isPetWindowLocation();
const isTeleprompterWindow = isTeleprompterLocation();
const isAuxiliaryWindow = isPetWindow || isTeleprompterWindow;
if (isPetWindow) {
  document.documentElement.dataset.neumaWindow = PET_WINDOW_QUERY_VALUE;
  document.body.dataset.neumaWindow = PET_WINDOW_QUERY_VALUE;
} else if (isTeleprompterWindow) {
  document.documentElement.dataset.neumaWindow =
    TELEPROMPTER_WINDOW_QUERY_VALUE;
  document.body.dataset.neumaWindow = TELEPROMPTER_WINDOW_QUERY_VALUE;
}

// Initialize settings from database on startup, then render app.
// The small pet window reads the localStorage snapshot and stays in sync via
// Tauri events from the main window, so it does not need broad DB access.
const settingsReady = isAuxiliaryWindow
  ? Promise.resolve()
  : initializeSettings();

settingsReady
  .catch((err: unknown) => {
    // Always log — this is a critical init failure the user needs to know about
    console.error('[Settings] Failed to initialize:', err);
  })
  .finally(() => {
    // Start the Tauri workspace watcher in the background so file changes
    // drive debounced graphify rebuilds and incremental RAG reindex. Fire-
    // and-forget — first paint must not wait for it. No-op outside Tauri.
    if (!isAuxiliaryWindow) {
      void getSettingsAsync()
        .then((settings) => {
          if (settings.workDir) return startWorkspaceWatcher(settings.workDir);
        })
        .catch((err) =>
          console.warn('[WorkspaceWatcher] Failed to start:', err),
        );
    }

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <LanguageProvider>
            <ThemeProvider>
              {isPetWindow ? (
                <PetWindowPage />
              ) : isTeleprompterWindow ? (
                <TeleprompterPage />
              ) : (
                <>
                  <AppUpdaterProvider>
                    <RouterProvider router={router} />
                  </AppUpdaterProvider>
                  <Toaster
                    position="top-right"
                    theme="system"
                    richColors
                    closeButton
                    duration={TOAST_DURATION_MS}
                  />
                </>
              )}
            </ThemeProvider>
          </LanguageProvider>
        </ErrorBoundary>
      </React.StrictMode>,
    );
  });
