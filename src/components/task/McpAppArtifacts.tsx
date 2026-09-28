import { useEffect, useState } from 'react';

import { useParams } from 'react-router-dom';

import { HtmlSandbox } from '@/components/artifacts/live';
import { API_BASE_URL } from '@/config';

import {
  mcpAppDocument,
  parseMcpToolName,
  type McpResourceContent,
} from './mcp-app-html';
import type { AGUIMessage, AGUIToolCall } from './TaskV2MessageBubble.types';
import { getToolName } from './TaskV2MessageBubble.types';

function toolFinished(tc: AGUIToolCall, allMessages: AGUIMessage[]): boolean {
  return allMessages.some(
    (message) => message.role === 'tool' && message.toolCallId === tc.id,
  );
}

function McpAppFrame({
  taskId,
  serverName,
  toolName,
  toolCallId,
}: {
  taskId: string;
  serverName: string;
  toolName: string;
  toolCallId: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [resourceCsp, setResourceCsp] = useState<string | undefined>();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/mcp/runtime/ui-resource`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, serverName, toolName }),
            signal: controller.signal,
          },
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          contents?: McpResourceContent[];
        };
        const document = mcpAppDocument(body.contents ?? []);
        if (!document || controller.signal.aborted) return;
        setHtml(document.html);
        setResourceCsp(document.resourceCsp);
      } catch {
        // A missing UI resource is the common case; leave the thread unchanged.
      }
    })();
    return () => controller.abort();
  }, [serverName, taskId, toolName]);

  if (!html) return null;
  return (
    <div className="border-border/50 my-2 overflow-hidden rounded-lg border">
      <HtmlSandbox
        html={html}
        identity={`${toolCallId}:${toolName}`}
        title={toolName}
        resourceCsp={resourceCsp}
      />
    </div>
  );
}

/** Sandboxed MCP App frames for invoked `mcp__server__tool` calls. */
export function McpAppArtifacts({
  toolCalls,
  allMessages,
}: {
  toolCalls: AGUIToolCall[];
  allMessages: AGUIMessage[];
}) {
  const { taskId } = useParams<{ taskId: string }>();
  if (!taskId) return null;
  const frames = toolCalls.flatMap((tc) => {
    const parsed = parseMcpToolName(getToolName(tc));
    if (!parsed || !toolFinished(tc, allMessages)) return [];
    return [{ tc, ...parsed }];
  });
  if (frames.length === 0) return null;
  return (
    <>
      {frames.map((frame) => (
        <McpAppFrame
          key={frame.tc.id}
          taskId={taskId}
          serverName={frame.serverName}
          toolName={frame.toolName}
          toolCallId={frame.tc.id}
        />
      ))}
    </>
  );
}
