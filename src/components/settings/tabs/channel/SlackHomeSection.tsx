/**
 * Slack-only "App Home" subsection of `ConfigTab`. Owns the credential
 * connector allowlist and the user-MCP policy. Pure controlled inputs —
 * the parent decides when to persist via `onSave`.
 */
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { type McpPolicy, SLACK_HOME_CONNECTORS } from './types';

export interface SlackHomeSectionProps {
  allowedConnectors: Set<string>;
  onToggleConnector: (key: string) => void;
  mcpPolicy: McpPolicy;
  onMcpPolicyChange: (policy: McpPolicy) => void;
}

export function SlackHomeSection({
  allowedConnectors,
  onToggleConnector,
  mcpPolicy,
  onMcpPolicyChange,
}: SlackHomeSectionProps) {
  const { t } = useLanguage();
  const s = t.settings;

  return (
    <div className="border-border space-y-2 rounded-md border border-dashed p-2.5">
      <div>
        <p className="text-foreground text-xs font-semibold">
          {s?.channelSlackAppHome ?? 'Slack App Home'}
        </p>
        <p className="text-muted-foreground text-xs">
          {s?.channelSlackAppHomeDesc ??
            'Controls what users see and can configure from this bot’s App Home tab.'}
        </p>
      </div>

      <div>
        <label className="text-foreground mb-1 block text-xs font-medium">
          {s?.channelHomeConnectors ?? 'Credential connectors'}
        </label>
        <div className="grid grid-cols-2 gap-1">
          {SLACK_HOME_CONNECTORS.map((c) => {
            const checked = allowedConnectors.has(c.key);
            return (
              <label
                key={c.key}
                className={cn(
                  'border-border flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                  checked
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleConnector(c.key)}
                  className="size-3"
                />
                {c.label}
              </label>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {allowedConnectors.size === SLACK_HOME_CONNECTORS.length
            ? (s?.channelHomeConnectorsAllHint ??
              'All connectors offered to users (default).')
            : (s?.channelHomeConnectorsLimitedHint ??
              'Only the checked connectors are offered to users.')}
        </p>
      </div>

      <div>
        <label
          htmlFor="mcp-policy-select"
          className="text-foreground mb-1 block text-xs font-medium"
        >
          {s?.channelHomeMcpPolicy ?? 'MCP servers policy'}
        </label>
        <select
          id="mcp-policy-select"
          value={mcpPolicy}
          onChange={(e) => onMcpPolicyChange(e.target.value as McpPolicy)}
          className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
        >
          <option value="open">
            {s?.channelHomeMcpPolicyOpen ?? 'Open — users self-add'}
          </option>
          <option value="admin-approved">
            {s?.channelHomeMcpPolicyAdminApproved ??
              'Admin-approved — review pending'}
          </option>
          <option value="disabled">
            {s?.channelHomeMcpPolicyDisabled ?? 'Disabled — hide MCP section'}
          </option>
        </select>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {mcpPolicy === 'open'
            ? (s?.channelHomeMcpPolicyOpenDesc ??
              'Users add MCP servers from Home; probed automatically.')
            : mcpPolicy === 'admin-approved'
              ? (s?.channelHomeMcpPolicyAdminApprovedDesc ??
                'New MCP rows are pending until an admin reviews them.')
              : (s?.channelHomeMcpPolicyDisabledDesc ??
                'The MCP section is hidden in the Home tab.')}
        </p>
      </div>
    </div>
  );
}
