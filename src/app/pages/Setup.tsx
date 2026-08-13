/**
 * Setup Page - First-time dependency installation
 *
 * Checks if required CLI tools (Claude Code, Codex) are installed
 * and guides users through installation.
 */

import { useEffect, useRef, useState } from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  Play,
  RefreshCw,
  Terminal,
} from 'lucide-react';

import { clearDependencyCache } from '@/components/setup-guard';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { API_BASE_URL, API_PORT, APP_NAME, APP_SLUG } from '@/config';
import { saveSettingItem } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// Helper function to copy text to clipboard
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  }
};

// Helper function to open terminal with command
const openTerminalWithCommand = async (command: string) => {
  // Copy command to clipboard first
  await copyToClipboard(command);

  try {
    // Open Terminal.app
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath('/System/Applications/Utilities/Terminal.app');
  } catch (error) {
    if (import.meta.env.DEV) console.error('Failed to open terminal:', error);
  }
};

interface DependencyStatus {
  id: string;
  name: string;
  description: string;
  required: boolean;
  installed: boolean;
  version?: string;
  installUrl: string;
}

interface InstallCommands {
  npm?: string;
  brew?: string;
  manual?: string;
}

type InstallMethod = 'auto' | 'npm' | 'brew';

interface InstallFeedback {
  status: 'success' | 'error';
  message: string;
}

interface SetupPageProps {
  /** Called when user skips setup (used by SetupGuard) */
  onSkip?: () => void;
}

export function SetupPage({ onSkip }: SetupPageProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, tt } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [dependencies, setDependencies] = useState<DependencyStatus[]>([]);
  const [allRequiredInstalled, setAllRequiredInstalled] = useState(false);
  const [expandedDep, setExpandedDep] = useState<string | null>(null);
  const [installCommands, setInstallCommands] = useState<
    Record<string, InstallCommands>
  >({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [installingDepId, setInstallingDepId] = useState<string | null>(null);
  const [installFeedback, setInstallFeedback] = useState<
    Record<string, InstallFeedback>
  >({});
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const installAbortRef = useRef<AbortController | null>(null);

  // Cleanup copy timeout and abort any in-flight install on unmount
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
      installAbortRef.current?.abort();
    };
  }, []);

  // Handle copy command
  const handleCopy = async (cmd: string) => {
    const success = await copyToClipboard(cmd);
    if (success) {
      setCopiedCmd(cmd);
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
      copiedTimeoutRef.current = setTimeout(() => setCopiedCmd(null), 2000);
    }
  };

  // Handle run command in terminal
  const handleRunInTerminal = async (cmd: string) => {
    await openTerminalWithCommand(cmd);
  };

  const handleOneClickInstall = async (
    dep: DependencyStatus,
    method: InstallMethod = 'auto',
  ) => {
    const commands = installCommands[dep.id];
    const commandPreview =
      method === 'npm'
        ? commands?.npm
        : method === 'brew'
          ? commands?.brew
          : commands?.npm || commands?.brew;

    if (
      !globalThis.confirm(
        tt('setup.installConfirm', {
          tool: dep.name,
          command: commandPreview || method,
        }),
      )
    ) {
      return;
    }

    // Abort any prior install still in flight before starting a new one.
    installAbortRef.current?.abort();
    const controller = new AbortController();
    installAbortRef.current = controller;

    setInstallingDepId(dep.id);
    setInstallFeedback((prev) => {
      const next = { ...prev };
      delete next[dep.id];
      return next;
    });

    try {
      const response = await fetch(
        `${API_BASE_URL}/health/dependencies/${dep.id}/install`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, confirmed: true }),
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            t.setup?.installFailed ||
            'Installation failed',
        );
      }

      if (controller.signal.aborted) return;
      setInstallFeedback((prev) => ({
        ...prev,
        [dep.id]: {
          status: 'success',
          message:
            data.message ||
            t.setup?.installSuccess ||
            'Installed successfully!',
        },
      }));
      await checkDependencies();
    } catch (error) {
      // Component unmounted / navigated away mid-install — drop the result.
      if (controller.signal.aborted) return;
      setInstallFeedback((prev) => ({
        ...prev,
        [dep.id]: {
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : t.setup?.installFailed || 'Installation failed',
        },
      }));
    } finally {
      if (!controller.signal.aborted) {
        setInstallingDepId(null);
      }
      if (installAbortRef.current === controller) {
        installAbortRef.current = null;
      }
    }
  };

  // Check dependencies on mount
  useEffect(() => {
    checkDependencies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const checkDependencies = async () => {
    setLoading(true);
    setApiError(null);
    // Clear SetupGuard cache to ensure fresh check on continue
    clearDependencyCache();

    // Retry logic for API not ready
    const maxRetries = 5;
    const retryDelay = 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${API_BASE_URL}/health/dependencies`);
        const data = await response.json();

        if (data.success) {
          setDependencies(data.dependencies);
          setAllRequiredInstalled(data.allRequiredInstalled);
          setRetryCount(0);

          // Load install commands for not-installed deps
          for (const dep of data.dependencies) {
            if (!dep.installed) {
              loadInstallCommands(dep.id);
            }
          }
          setLoading(false);
          return;
        }
      } catch (error) {
        console.error(
          `[Setup] Attempt ${attempt + 1}/${maxRetries} failed:`,
          error,
        );
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          setRetryCount(attempt + 1);
        } else {
          // Provide a clear error message based on the failure type
          const rawMsg = error instanceof Error ? error.message : String(error);
          const isConnectionRefused =
            rawMsg === 'Load failed' ||
            rawMsg.includes('Failed to fetch') ||
            rawMsg.includes('ECONNREFUSED') ||
            rawMsg.includes('NetworkError');
          setApiError(
            isConnectionRefused
              ? `Connection refused — the API service on port ${API_PORT} is not running`
              : rawMsg,
          );
        }
      }
    }
    setLoading(false);
  };

  const loadInstallCommands = async (depId: string) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/health/dependencies/${depId}/install-commands`,
      );
      const data = await response.json();
      if (data.success) {
        setInstallCommands((prev) => ({
          ...prev,
          [depId]: data.commands,
        }));
      }
    } catch (error) {
      console.error(
        `[Setup] Failed to load install commands for ${depId}:`,
        error,
      );
    }
  };

  const handleContinue = async () => {
    // Mark setup as completed
    await saveSettingItem('setupCompleted', 'true');
    // Clear the dependency cache so SetupGuard will re-check
    clearDependencyCache();

    // If called from SetupGuard, use callback
    if (onSkip) {
      onSkip();
      return;
    }

    // Otherwise navigate back
    const from = (location.state as { from?: Location })?.from;
    navigate(from?.pathname || '/', { replace: true });
  };

  const handleSkip = async () => {
    // Mark setup as completed even if skipped
    await saveSettingItem('setupCompleted', 'true');
    // Clear cache so next check will be fresh
    clearDependencyCache();

    // If called from SetupGuard, use callback
    if (onSkip) {
      onSkip();
      return;
    }

    // Otherwise navigate back
    const from = (location.state as { from?: Location })?.from;
    navigate(from?.pathname || '/', { replace: true });
  };

  if (loading) {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <AILoadingIndicator size="md" />
          <p className="text-muted-foreground">
            {retryCount > 0
              ? `${tt('setup.connecting', { appName: APP_NAME })}... (${retryCount}/5)`
              : tt('setup.checking')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-svh items-center justify-center">
      {/* Main Container - Centered */}
      <div className="w-full max-w-2xl px-6">
        {/* Header */}
        <div className="border-border border-b py-6">
          <h1 className="text-foreground text-2xl font-semibold">
            {tt('setup.title', { appName: APP_NAME })}
          </h1>
          <p className="text-muted-foreground mt-2">{t.setup?.subtitle}</p>
        </div>

        {/* Content */}
        <div className="py-6">
          <div className="space-y-4">
            {/* API Error */}
            {apiError && (
              <div className="border-border rounded-xl border bg-orange-500/5 p-6">
                <div className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-orange-500">
                    <AlertCircle className="size-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-foreground font-medium">
                      {t.setup?.apiError || 'Unable to check dependencies'}
                    </h3>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {t.setup?.apiErrorHint ||
                        'The background service may still be starting. Please wait a few seconds and retry.'}
                    </p>
                    <p className="text-muted-foreground/60 mt-2 font-mono text-xs">
                      {apiError}
                    </p>

                    {/* Diagnostic details */}
                    <div className="bg-muted/50 mt-3 rounded-lg p-3">
                      <p className="text-muted-foreground mb-2 text-xs font-medium">
                        {t.setup?.diagnostics || 'Diagnostics'}
                      </p>
                      <div className="space-y-1 font-mono text-xs">
                        <p className="text-muted-foreground/80">
                          API: {API_BASE_URL}/health/dependencies
                        </p>
                        <p className="text-muted-foreground/80">
                          {t.setup?.diagnosticsPort || 'Port'}: {API_PORT} (
                          {import.meta.env.PROD ? 'production' : 'development'})
                        </p>
                        <div className="text-muted-foreground/80 flex items-center gap-1">
                          <FolderOpen className="size-3 shrink-0" />
                          <span>
                            {t.setup?.diagnosticsLogs || 'Logs'}: ~/.{APP_SLUG}
                            /logs/
                          </span>
                        </div>
                      </div>
                      <p className="text-muted-foreground/60 mt-2 text-xs">
                        {t.setup?.diagnosticsHint ||
                          'If the problem persists after restarting, check the log directory above for error details. In development, ensure the API server is running (pnpm dev:api).'}
                      </p>
                    </div>

                    <button
                      onClick={checkDependencies}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                    >
                      <RefreshCw className="size-4" />
                      {t.setup?.retry || 'Retry'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* No dependencies loaded yet */}
            {!apiError && dependencies.length === 0 && (
              <div className="border-border rounded-xl border p-6 text-center">
                <p className="text-muted-foreground">
                  {t.setup?.noDeps || 'No dependencies to check'}
                </p>
              </div>
            )}

            {dependencies.map((dep) => {
              const isExpanded = expandedDep === dep.id;
              const commands = installCommands[dep.id];

              return (
                <div
                  key={dep.id}
                  className={cn(
                    'border-border rounded-xl border transition-all',
                    dep.installed ? 'bg-muted/30' : 'bg-background',
                  )}
                >
                  {/* Dependency Header */}
                  <div className="flex items-center gap-4 p-4">
                    {/* Status Icon */}
                    <div
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-full',
                        dep.installed
                          ? 'bg-green-500/10 text-green-500'
                          : dep.required
                            ? 'bg-orange-500/10 text-orange-500'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {dep.installed ? (
                        <CheckCircle2 className="size-5" />
                      ) : (
                        <Terminal className="size-5" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-medium">
                          {dep.name}
                        </span>
                        {dep.required && !dep.installed && (
                          <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-500">
                            {t.setup?.required || 'Required'}
                          </span>
                        )}
                        {!dep.required && (
                          <span className="text-muted-foreground rounded bg-gray-500/10 px-1.5 py-0.5 text-[10px] font-medium">
                            {t.setup?.optional || 'Optional'}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        {dep.description}
                      </p>
                      {dep.installed && dep.version && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {t.setup?.version || 'Version'}: {dep.version}
                        </p>
                      )}
                    </div>

                    {/* Action */}
                    {dep.installed ? (
                      <Check className="size-5 shrink-0 text-green-500" />
                    ) : (
                      <button
                        onClick={() =>
                          setExpandedDep(isExpanded ? null : dep.id)
                        }
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-5" />
                        ) : (
                          <ChevronRight className="size-5" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Install Options (Expanded) */}
                  {!dep.installed && isExpanded && (
                    <div className="border-border border-t px-4 py-4">
                      {(commands?.npm || commands?.brew) && (
                        <div className="mb-4 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-foreground text-sm font-medium">
                                {t.setup?.oneClickInstall ||
                                  'One-Click Install'}
                              </p>
                              <p className="text-muted-foreground mt-1 text-xs">
                                {t.setup?.oneClickInstallHint ||
                                  'Runs an allowlisted installer for this dependency. You can copy the command instead.'}
                              </p>
                            </div>
                            <button
                              onClick={() => handleOneClickInstall(dep)}
                              disabled={installingDepId === dep.id}
                              className={cn(
                                'bg-primary text-primary-foreground hover:bg-primary/90 flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                                installingDepId === dep.id &&
                                  'cursor-not-allowed opacity-70',
                              )}
                            >
                              {installingDepId === dep.id ? (
                                <RefreshCw className="size-3 animate-spin" />
                              ) : (
                                <Download className="size-3" />
                              )}
                              {installingDepId === dep.id
                                ? t.setup?.installing || 'Installing...'
                                : t.setup?.oneClickInstall ||
                                  'One-Click Install'}
                            </button>
                          </div>
                          {installFeedback[dep.id] && (
                            <p
                              className={cn(
                                'mt-3 text-xs',
                                installFeedback[dep.id].status === 'success'
                                  ? 'text-green-600'
                                  : 'text-orange-600',
                              )}
                            >
                              {installFeedback[dep.id].message}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Install Commands */}
                      {commands && (
                        <div className="space-y-2">
                          {commands.npm && (
                            <div className="bg-muted flex items-center gap-2 rounded-lg px-3 py-2">
                              <code className="flex-1 font-mono text-sm">
                                {commands.npm}
                              </code>
                              <button
                                onClick={() =>
                                  handleRunInTerminal(commands.npm!)
                                }
                                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs transition-colors"
                              >
                                <Play className="size-3" />
                                {t.setup?.run || 'Run'}
                              </button>
                              <button
                                onClick={() => handleCopy(commands.npm!)}
                                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs transition-colors"
                              >
                                {copiedCmd === commands.npm ? (
                                  <Check className="size-3 text-green-500" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                                {t.setup?.copy || 'Copy'}
                              </button>
                            </div>
                          )}
                          {commands.brew && (
                            <div className="bg-muted flex items-center gap-2 rounded-lg px-3 py-2">
                              <code className="flex-1 font-mono text-sm">
                                {commands.brew}
                              </code>
                              <button
                                onClick={() =>
                                  handleRunInTerminal(commands.brew!)
                                }
                                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs transition-colors"
                              >
                                <Play className="size-3" />
                                {t.setup?.run || 'Run'}
                              </button>
                              <button
                                onClick={() => handleCopy(commands.brew!)}
                                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs transition-colors"
                              >
                                {copiedCmd === commands.brew ? (
                                  <Check className="size-3 text-green-500" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                                {t.setup?.copy || 'Copy'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-border border-t py-4">
          <div className="flex items-center justify-between">
            {/* Refresh Button */}
            <button
              onClick={checkDependencies}
              className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
            >
              <RefreshCw className="size-4" />
              {t.setup?.refresh || 'Refresh'}
            </button>

            <div className="flex items-center gap-3">
              {/* Skip Button */}
              {!allRequiredInstalled && (
                <button
                  onClick={handleSkip}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
                >
                  {t.setup?.skipForNow || 'Skip for now'}
                </button>
              )}

              {/* Continue Button */}
              <button
                onClick={handleContinue}
                disabled={
                  !allRequiredInstalled &&
                  dependencies.some((d) => d.required && !d.installed)
                }
                className={cn(
                  'flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors',
                  allRequiredInstalled
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed',
                )}
              >
                {allRequiredInstalled
                  ? t.setup?.continue || 'Continue'
                  : t.setup?.installRequired || 'Install required tools'}
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
