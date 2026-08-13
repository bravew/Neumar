/**
 * Low-level Slack Web API helper shared by search and messaging modules.
 */

export interface SlackApiResponse {
  ok?: boolean;
  error?: string;
  results?: Record<string, unknown[]>;
  user?: Record<string, unknown>;
  members?: Record<string, unknown>[];
  channel?: { id?: string };
  channels?: unknown[];
  ts?: string;
  response_metadata?: { next_cursor?: string };
}

export async function slackPost(
  token: string,
  method: string,
  params: Record<string, unknown>,
): Promise<SlackApiResponse> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Slack API ${method} HTTP ${res.status}`);
  return res.json();
}
