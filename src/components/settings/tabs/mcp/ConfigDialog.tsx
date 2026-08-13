import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Plus, Trash2, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

import { initialConfigDialog } from './constants';
import type { ConfigDialogState } from './types';

export function ConfigDialog({
  configDialog,
  setConfigDialog,
  onSave,
}: {
  configDialog: ConfigDialogState;
  setConfigDialog: (state: ConfigDialogState) => void;
  onSave: () => void;
}) {
  const { t } = useLanguage();

  // Argument handlers
  const handleAddArg = () => {
    setConfigDialog({
      ...configDialog,
      args: [...configDialog.args, ''],
    });
  };

  const handleUpdateArg = (index: number, value: string) => {
    const newArgs = [...configDialog.args];
    newArgs[index] = value;
    setConfigDialog({ ...configDialog, args: newArgs });
  };

  const handleRemoveArg = (index: number) => {
    const newArgs = configDialog.args.filter((_, i) => i !== index);
    setConfigDialog({ ...configDialog, args: newArgs });
  };

  const handleAddEnv = () => {
    setConfigDialog({
      ...configDialog,
      env: [
        ...configDialog.env,
        { id: `env-${randomUUID()}`, key: '', value: '' },
      ],
    });
  };

  const handleUpdateEnv = (id: string, key: string, value: string) => {
    setConfigDialog({
      ...configDialog,
      env: configDialog.env.map((item) =>
        item.id === id ? { ...item, key, value } : item,
      ),
    });
  };

  const handleRemoveEnv = (id: string) => {
    setConfigDialog({
      ...configDialog,
      env: configDialog.env.filter((item) => item.id !== id),
    });
  };

  // Header handlers
  const handleAddHeader = () => {
    setConfigDialog({
      ...configDialog,
      headers: [
        ...configDialog.headers,
        { id: `header-${randomUUID()}`, key: '', value: '' },
      ],
    });
  };

  const handleUpdateHeader = (id: string, key: string, value: string) => {
    setConfigDialog({
      ...configDialog,
      headers: configDialog.headers.map((item) =>
        item.id === id ? { ...item, key, value } : item,
      ),
    });
  };

  const handleRemoveHeader = (id: string) => {
    setConfigDialog({
      ...configDialog,
      headers: configDialog.headers.filter((item) => item.id !== id),
    });
  };

  return (
    <DialogPrimitive.Root
      open={configDialog.open}
      onOpenChange={(open) => {
        if (!open) setConfigDialog(initialConfigDialog);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <DialogPrimitive.Content className="bg-background border-border fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[500px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border shadow-2xl focus:outline-none">
          {/* Header */}
          <div className="border-border shrink-0 border-b px-6 py-4">
            <DialogPrimitive.Title className="text-foreground text-lg font-semibold">
              {t.settings.mcpConfigTitle}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm transition-opacity focus:outline-none"
              aria-label="Close"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              {/* Server Name */}
              <div>
                <label className="text-foreground mb-2 block text-sm font-medium">
                  {t.settings.mcpServerName}
                </label>
                <input
                  type="text"
                  value={configDialog.serverName}
                  onChange={(e) =>
                    setConfigDialog({
                      ...configDialog,
                      serverName: e.target.value,
                    })
                  }
                  placeholder={t.settings.mcpServerNamePlaceholder}
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  aria-label={t.settings.mcpServerName}
                />
              </div>

              {/* Transport Type */}
              <div>
                <label className="text-foreground mb-2 block text-sm font-medium">
                  {t.settings.mcpTransportType}
                </label>
                <select
                  value={configDialog.transportType}
                  onChange={(e) =>
                    setConfigDialog({
                      ...configDialog,
                      transportType: e.target.value as 'stdio' | 'http' | 'sse',
                    })
                  }
                  className="border-input bg-background text-foreground focus:ring-ring h-10 w-full cursor-pointer rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  aria-label={t.settings.mcpTransportType}
                >
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                  <option value="sse">sse</option>
                </select>
              </div>

              {configDialog.transportType === 'stdio' ? (
                /* Stdio config fields */
                <>
                  {/* Command */}
                  <div>
                    <label className="text-foreground mb-2 block text-sm font-medium">
                      {t.settings.mcpCommand}
                    </label>
                    <input
                      type="text"
                      value={configDialog.command}
                      onChange={(e) =>
                        setConfigDialog({
                          ...configDialog,
                          command: e.target.value,
                        })
                      }
                      placeholder={t.settings.mcpCommandPlaceholder}
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                      aria-label={t.settings.mcpCommand}
                    />
                  </div>

                  {/* Arguments */}
                  <div>
                    <label className="text-foreground mb-2 block text-sm font-medium">
                      {t.settings.mcpArguments}
                    </label>
                    <div className="space-y-2">
                      {configDialog.args.map((arg, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={arg}
                            onChange={(e) =>
                              handleUpdateArg(index, e.target.value)
                            }
                            placeholder={t.settings.mcpArgumentPlaceholder}
                            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            aria-label={`${t.settings.mcpArguments} ${index + 1}`}
                          />
                          <button
                            onClick={() => handleRemoveArg(index)}
                            className="text-muted-foreground hover:text-destructive flex size-10 items-center justify-center rounded-lg transition-colors"
                            aria-label={`Remove argument ${index + 1}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={handleAddArg}
                        className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
                      >
                        <Plus className="size-4" />
                        {t.settings.mcpAddArgument}
                      </button>
                    </div>
                  </div>

                  {/* Environment Variables */}
                  <div>
                    <label className="text-foreground mb-2 block text-sm font-medium">
                      {t.settings.mcpEnvVariables}
                    </label>
                    <div className="space-y-2">
                      {configDialog.env.map((item) => (
                        <div key={item.id} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item.key}
                            onChange={(e) =>
                              handleUpdateEnv(
                                item.id,
                                e.target.value,
                                item.value,
                              )
                            }
                            placeholder={t.settings.mcpEnvVariableName}
                            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-32 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            aria-label={`Environment variable name`}
                          />
                          <span className="text-muted-foreground">=</span>
                          <input
                            type="text"
                            value={item.value}
                            onChange={(e) =>
                              handleUpdateEnv(item.id, item.key, e.target.value)
                            }
                            placeholder={t.settings.mcpEnvVariableValue}
                            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            aria-label={`Environment variable value`}
                          />
                          <button
                            onClick={() => handleRemoveEnv(item.id)}
                            className="text-muted-foreground hover:text-destructive flex size-10 items-center justify-center rounded-lg transition-colors"
                            aria-label="Remove environment variable"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={handleAddEnv}
                        className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
                      >
                        <Plus className="size-4" />
                        {t.settings.mcpAddEnvVariable}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* URL */}
                  <div>
                    <label className="text-foreground mb-2 block text-sm font-medium">
                      {t.settings.mcpServerUrl}
                    </label>
                    <input
                      type="text"
                      value={configDialog.url}
                      onChange={(e) =>
                        setConfigDialog({
                          ...configDialog,
                          url: e.target.value,
                        })
                      }
                      placeholder={
                        configDialog.transportType === 'sse'
                          ? t.settings.mcpServerUrlPlaceholderSse
                          : t.settings.mcpServerUrlPlaceholder
                      }
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                      aria-label={t.settings.mcpServerUrl}
                    />
                  </div>

                  {/* Custom Headers */}
                  <div>
                    <label className="text-foreground mb-2 block text-sm font-medium">
                      {t.settings.mcpCustomHeaders}{' '}
                      <span className="text-muted-foreground font-normal">
                        {t.settings.mcpCustomHeadersOptional}
                      </span>
                    </label>
                    <div className="space-y-2">
                      {configDialog.headers.map((item) => (
                        <div key={item.id} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item.key}
                            onChange={(e) =>
                              handleUpdateHeader(
                                item.id,
                                e.target.value,
                                item.value,
                              )
                            }
                            placeholder={t.settings.mcpHeaders || 'Header Name'}
                            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-32 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            aria-label="Header name"
                          />
                          <span className="text-muted-foreground">=</span>
                          <input
                            type="text"
                            value={item.value}
                            onChange={(e) =>
                              handleUpdateHeader(
                                item.id,
                                item.key,
                                e.target.value,
                              )
                            }
                            placeholder={'Value'}
                            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            aria-label="Header value"
                          />
                          <button
                            onClick={() => handleRemoveHeader(item.id)}
                            className="text-muted-foreground hover:text-destructive flex size-10 items-center justify-center rounded-lg transition-colors"
                            aria-label="Remove header"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={handleAddHeader}
                        className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
                      >
                        <Plus className="size-4" />
                        {t.settings.mcpAddCustomHeader}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-border shrink-0 border-t px-6 py-4">
            <button
              onClick={onSave}
              disabled={!configDialog.serverName}
              className="bg-foreground text-background hover:bg-foreground/90 flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.settings.mcpSave}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
