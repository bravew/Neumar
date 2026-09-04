import { useCallback, useEffect, useRef, useState } from 'react';

import { Copy } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../../components/Switch';
import type { SettingsTabProps } from '../../types';
import {
  hostAddCommand,
  hostRemoveCommand,
  hostStatusHint,
} from './external-mcp-install';
import type {
  ExternalMcpInstallInfo,
  ExternalMcpStatus,
} from './external-mcp-types';

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function CommandRow({
  label,
  value,
  copiedLabel,
}: {
  label: string;
  value: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    },
    [],
  );
  const onCopy = useCallback(async () => {
    await copyText(value);
    setCopied(true);
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current);
    }
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }, [value]);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-foreground text-xs font-medium">{label}</p>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
        >
          <Copy className="size-3" />
          {copied ? copiedLabel : label}
        </button>
      </div>
      <pre className="bg-muted text-muted-foreground overflow-x-auto rounded px-2 py-2 text-[11px] break-words whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  );
}

export function ExternalMcpServerPanel({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const [info, setInfo] = useState<ExternalMcpInstallInfo | null>(null);
  const [status, setStatus] = useState<ExternalMcpStatus | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const [installRes, statusRes] = await Promise.all([
          fetch(`${API_BASE_URL}/mcp/server/install-info`, {
            signal: abort.signal,
          }),
          fetch(`${API_BASE_URL}/mcp/server/status`, { signal: abort.signal }),
        ]);
        if (installRes.ok) {
          setInfo((await installRes.json()) as ExternalMcpInstallInfo);
        }
        if (statusRes.ok) {
          setStatus((await statusRes.json()) as ExternalMcpStatus);
        }
      } catch {
        if (abort.signal.aborted) return;
      }
    }
    void load();
    return () => abort.abort();
  }, []);

  return (
    <div className="border-border bg-background space-y-4 rounded-xl border p-4">
      <div>
        <h3 className="text-foreground text-sm font-medium">
          {t.settings.externalMcpHeading}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {t.settings.externalMcpIntro}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p id="external-mcp-enable-label" className="text-foreground text-sm">
            {t.settings.externalMcpEnable}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.settings.externalMcpEnableHelp}
          </p>
        </div>
        <Switch
          checked={settings.externalMcpEnabled}
          aria-labelledby="external-mcp-enable-label"
          onChange={(checked) =>
            onSettingsChange({ ...settings, externalMcpEnabled: checked })
          }
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p id="external-mcp-writes-label" className="text-foreground text-sm">
            {t.settings.externalMcpWrites}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.settings.externalMcpWritesHelp}
          </p>
        </div>
        <Switch
          checked={settings.externalMcpWritesEnabled}
          disabled={!settings.externalMcpEnabled}
          aria-labelledby="external-mcp-writes-label"
          onChange={(checked) =>
            onSettingsChange({
              ...settings,
              externalMcpWritesEnabled: checked,
            })
          }
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p id="external-mcp-runs-label" className="text-foreground text-sm">
            {t.settings.externalMcpRuns}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.settings.externalMcpRunsHelp}
          </p>
        </div>
        <Switch
          checked={settings.externalMcpAgentRunsEnabled}
          disabled={!settings.externalMcpEnabled}
          aria-labelledby="external-mcp-runs-label"
          onChange={(checked) =>
            onSettingsChange({
              ...settings,
              externalMcpAgentRunsEnabled: checked,
            })
          }
        />
      </div>

      <p className="text-muted-foreground text-xs">
        {t.settings.externalMcpRunningHint}{' '}
        {t.settings.externalMcpCodexApprovalHint}{' '}
        {t.settings.externalMcpClaudeScopeHint}
      </p>

      {status?.daemonUrl ? (
        <p className="text-muted-foreground text-xs">
          {status.daemonUrl}
          {info?.development ? ' · dev' : ''}
        </p>
      ) : null}

      {info && !info.binaryExists ? (
        <p className="text-xs text-amber-600">
          {t.settings.externalMcpBinaryMissing}
          {info.buildHint ? ` — ${info.buildHint}` : ''}
        </p>
      ) : null}

      {info ? (
        <div className="space-y-3">
          <CommandRow
            label={t.settings.externalMcpCopyCodexAdd}
            value={hostAddCommand(info, 'codex')}
            copiedLabel={t.settings.externalMcpCopied}
          />
          <CommandRow
            label={t.settings.externalMcpCopyClaudeAdd}
            value={hostAddCommand(info, 'claude')}
            copiedLabel={t.settings.externalMcpCopied}
          />
          <CommandRow
            label={t.settings.externalMcpCopyCodexRemove}
            value={hostRemoveCommand(info, 'codex')}
            copiedLabel={t.settings.externalMcpCopied}
          />
          <CommandRow
            label={t.settings.externalMcpCopyClaudeRemove}
            value={hostRemoveCommand(info, 'claude')}
            copiedLabel={t.settings.externalMcpCopied}
          />
          <p className="text-muted-foreground text-xs">
            {hostStatusHint('codex')} · {hostStatusHint('claude')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
