import { useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, Clipboard, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

import type { MCPServerUI } from '../../types';
import {
  buildMcpPreview,
  buildMcpServerFromHelper,
  validateMcpHelperDraft,
  type AuthType,
  type McpHelperDraft,
  type Transport,
} from './McpJsonHelperUtils';

const INPUT_CLASS =
  'border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-full rounded-md border px-3 text-sm focus:ring-1 focus:outline-none';

export function McpJsonHelper({
  onApply,
}: {
  onApply: (server: MCPServerUI) => void;
}) {
  const { t } = useLanguage();
  const settingsText = t.settings as Record<string, string>;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<McpHelperDraft>({
    name: '',
    transport: 'http',
    command: '',
    argsText: '',
    url: '',
    authType: 'oauth2.1',
    envRows: [],
  });
  const envValuesRef = useRef(new Map<string, string>());

  const validation = useMemo(() => validateMcpHelperDraft(draft), [draft]);
  const preview = useMemo(
    () =>
      JSON.stringify(
        buildMcpPreview(draft, envValuesRef.current, true),
        null,
        2,
      ),
    [draft],
  );

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(id);
  }, [copied]);

  const updateDraft = (patch: Partial<McpHelperDraft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (patch.transport && patch.transport !== 'stdio' && !prev.url) {
        next.authType = 'oauth2.1';
      }
      return next;
    });
  };

  const addEnvRow = () => {
    setDraft((prev) => ({
      ...prev,
      envRows: [
        ...prev.envRows,
        { id: `env-${randomUUID()}`, key: '', valueLength: 0 },
      ],
    }));
  };

  const removeEnvRow = (id: string) => {
    envValuesRef.current.delete(id);
    setDraft((prev) => ({
      ...prev,
      envRows: prev.envRows.filter((row) => row.id !== id),
    }));
  };

  const updateEnvKey = (id: string, key: string) => {
    setDraft((prev) => ({
      ...prev,
      envRows: prev.envRows.map((row) =>
        row.id === id ? { ...row, key } : row,
      ),
    }));
  };

  const updateEnvValueLength = (id: string, value: string) => {
    envValuesRef.current.set(id, value);
    setDraft((prev) => ({
      ...prev,
      envRows: prev.envRows.map((row) =>
        row.id === id ? { ...row, valueLength: value.length } : row,
      ),
    }));
  };

  const copyPreview = async () => {
    await navigator.clipboard?.writeText(preview);
    setCopied(true);
  };

  const apply = () => {
    if (!validation.valid) return;
    onApply(buildMcpServerFromHelper(draft, envValuesRef.current));
  };

  return (
    <section className="border-border bg-background rounded-xl border">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <h3 className="text-foreground text-sm font-medium">
            {t.settings.mcpJsonHelperTitle}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.settings.mcpJsonHelperDescription}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 transition-transform',
            !expanded && '-rotate-90',
          )}
        />
      </button>

      {expanded && (
        <div className="border-border grid gap-4 border-t p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">
              {t.settings.mcpJsonHelperFields}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-foreground text-xs font-medium">
                  {t.settings.mcpServerName}
                </span>
                <input
                  value={draft.name}
                  onChange={(event) =>
                    updateDraft({ name: event.target.value })
                  }
                  className={INPUT_CLASS}
                />
              </label>
              <label className="space-y-1">
                <span className="text-foreground text-xs font-medium">
                  {t.settings.mcpTransportType}
                </span>
                <select
                  value={draft.transport}
                  onChange={(event) =>
                    updateDraft({
                      transport: event.target.value as Transport,
                    })
                  }
                  className={INPUT_CLASS}
                >
                  <option value="http">http</option>
                  <option value="sse">sse</option>
                  <option value="stdio">stdio</option>
                </select>
              </label>
            </div>

            {draft.transport === 'stdio' ? (
              <>
                <label className="space-y-1">
                  <span className="text-foreground text-xs font-medium">
                    {t.settings.mcpCommand}
                  </span>
                  <input
                    value={draft.command}
                    onChange={(event) =>
                      updateDraft({ command: event.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-foreground text-xs font-medium">
                    {t.settings.mcpArguments}
                  </span>
                  <textarea
                    value={draft.argsText}
                    onChange={(event) =>
                      updateDraft({ argsText: event.target.value })
                    }
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring min-h-20 w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                    placeholder={t.settings.mcpJsonHelperArgsPlaceholder}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="space-y-1">
                  <span className="text-foreground text-xs font-medium">
                    {t.settings.mcpServerUrl}
                  </span>
                  <input
                    value={draft.url}
                    onChange={(event) =>
                      updateDraft({ url: event.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-foreground text-xs font-medium">
                    {t.settings.mcpJsonHelperAuth}
                  </span>
                  <select
                    value={draft.authType}
                    onChange={(event) =>
                      updateDraft({ authType: event.target.value as AuthType })
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="oauth2.1">oauth2.1 PKCE-S256</option>
                    <option value="none">
                      {t.settings.mcpJsonHelperNoAuth}
                    </option>
                  </select>
                </label>
              </>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-foreground text-xs font-medium">
                  {t.settings.mcpEnvVariables}
                </span>
                <button
                  type="button"
                  onClick={addEnvRow}
                  className="text-primary hover:text-primary/80 flex items-center gap-1 text-xs"
                >
                  <Plus className="size-3.5" />
                  {t.settings.mcpAddEnvVariable}
                </button>
              </div>
              {draft.envRows.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <input
                    value={row.key}
                    onChange={(event) =>
                      updateEnvKey(row.id, event.target.value)
                    }
                    className={INPUT_CLASS}
                    placeholder={t.settings.mcpEnvVariableName}
                  />
                  <input
                    type="password"
                    onChange={(event) =>
                      updateEnvValueLength(row.id, event.target.value)
                    }
                    className={INPUT_CLASS}
                    placeholder={t.settings.mcpEnvVariableValue}
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvRow(row.id)}
                    className="text-muted-foreground hover:text-destructive rounded p-2"
                    aria-label={t.settings.mcpJsonHelperRemoveEnv}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            {(validation.errors.length > 0 ||
              validation.warnings.length > 0) && (
              <div className="space-y-1 text-xs">
                {validation.errors.map((error) => (
                  <p key={error} className="text-destructive">
                    {settingsText[error] ?? error}
                  </p>
                ))}
                {validation.warnings.map((warning) => (
                  <p key={warning} className="text-amber-600">
                    {settingsText[warning] ?? warning}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <pre className="bg-muted/50 text-foreground max-h-80 overflow-auto rounded-lg p-3 text-xs">
              {preview}
            </pre>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyPreview}
                disabled={!validation.valid}
                className="border-border hover:bg-accent flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Clipboard className="size-3.5" />
                {copied
                  ? t.settings.mcpJsonHelperCopied
                  : t.settings.mcpJsonHelperCopy}
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!validation.valid}
                className="bg-foreground text-background hover:bg-foreground/90 rounded-md px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.settings.mcpJsonHelperApply}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
