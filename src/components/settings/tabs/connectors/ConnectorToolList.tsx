import { useEffect, useState } from 'react';

import { Switch } from '@/components/settings/components/Switch';
import { API_BASE_URL } from '@/config';

import { defaultConnectorMessages, type ConnectorMessages } from './messages';
import { ConnectorBadge } from './parts';
import type {
  ConnectorToolApproval,
  ConnectorToolDetail,
  ConnectorToolSideEffect,
} from './types';

interface ConnectorToolListProps {
  connectorId: string;
  messages?: ConnectorMessages;
  tools: ConnectorToolDetail[];
}

export function ConnectorToolList({
  connectorId,
  messages = defaultConnectorMessages,
  tools,
}: ConnectorToolListProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? tools : tools.slice(0, 6);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{messages.tools.title}</h3>
        {tools.length > 6 && (
          <button
            type="button"
            className="text-primary text-xs"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? messages.tools.hideTools
              : messages.tools.showAllTools.replace(
                  '{count}',
                  String(tools.length),
                )}
          </button>
        )}
      </div>
      <div className="divide-border rounded-md border">
        {visible.map((tool) => (
          <ToolRow
            key={tool.name}
            connectorId={connectorId}
            messages={messages}
            tool={tool}
          />
        ))}
      </div>
    </section>
  );
}

function ToolRow({
  connectorId,
  messages,
  tool,
}: {
  connectorId: string;
  messages: ConnectorMessages;
  tool: ConnectorToolDetail;
}) {
  const [approval, setApproval] = useState(tool.safety.approval);
  const [savedApproval, setSavedApproval] = useState(tool.safety.approval);
  const disabled = tool.safety.approval === 'disabled';

  useEffect(() => {
    setApproval(tool.safety.approval);
    setSavedApproval(tool.safety.approval);
  }, [tool.safety.approval]);

  async function updateApproval(next: ConnectorToolApproval) {
    const previous = savedApproval;
    setApproval(next);
    const res = await fetch(
      `${API_BASE_URL}/connectors/${connectorId}/tools/${encodeURIComponent(tool.name)}/override`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-neuma-admin-origin': 'desktop',
        },
        body: JSON.stringify({ approval: next, accountId: 'default' }),
      },
    ).catch(() => null);
    if (!res?.ok) {
      setApproval(previous);
      return;
    }
    setSavedApproval(next);
  }

  return (
    <div className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-sm font-medium">{tool.title}</div>
        {tool.description && (
          <p className="text-muted-foreground line-clamp-3 text-xs">
            {tool.description}
          </p>
        )}
        <code className="text-muted-foreground/80 block truncate font-mono text-[10px]">
          {tool.name}
        </code>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SideEffectBadge value={tool.safety.sideEffect} />
        <ConnectorBadge tone={approvalTone(approval)}>
          {approval}
        </ConnectorBadge>
        <Switch
          checked={approval === 'auto'}
          disabled={disabled}
          label={messages.tools.toggleApproval.replace('{tool}', tool.title)}
          onChange={(checked) =>
            void updateApproval(checked ? 'auto' : 'confirm')
          }
        />
      </div>
    </div>
  );
}

function SideEffectBadge({ value }: { value: ConnectorToolSideEffect }) {
  return (
    <ConnectorBadge
      tone={value === 'read' ? 'neutral' : value === 'write' ? 'amber' : 'red'}
    >
      {value}
    </ConnectorBadge>
  );
}

function approvalTone(value: ConnectorToolApproval) {
  if (value === 'auto') return 'green';
  if (value === 'confirm') return 'amber';
  return 'red';
}
