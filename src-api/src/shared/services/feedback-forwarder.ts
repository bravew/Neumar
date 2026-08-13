/**
 * Optional remote feedback forwarding via NEUMA_FEEDBACK_ENDPOINT.
 * Local DB is the source of truth; this is best-effort.
 */

import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrlForFetch } from '@/shared/utils/url-validator';

import type { FeedbackRow } from './feedback-store';

const logger = createLogger('FeedbackForwarder');

const FORWARD_TIMEOUT_MS = 10_000;

export interface ForwardResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export function isRemoteForwardingEnabled(): boolean {
  return Boolean(process.env['NEUMA_FEEDBACK_ENDPOINT']);
}

export async function forwardFeedback(
  row: FeedbackRow,
): Promise<ForwardResult> {
  const endpoint = process.env['NEUMA_FEEDBACK_ENDPOINT'];
  if (!endpoint) return { ok: false, error: 'no-endpoint' };

  // SSRF guard: block private IPs, cloud metadata hostnames, non-HTTPS.
  // The endpoint is operator-supplied via env, but a misconfiguration must
  // never let the sidecar reach internal services on the host.
  const validated = await validateBaseUrlForFetch(endpoint, 'POST');
  if (!validated.valid) {
    logger.warn(
      `Refusing to forward feedback — invalid endpoint: ${validated.reason}`,
    );
    return { ok: false, error: `invalid-endpoint:${validated.reason}` };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: row.id,
        category: row.category,
        subject: row.subject,
        description: row.description,
        email: row.email,
        appName: row.app_name,
        appVersion: row.app_version,
        diagnostics: row.diagnostics_json
          ? JSON.parse(row.diagnostics_json)
          : null,
        linearId: row.linear_id,
        createdAt: row.created_at,
      }),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      redirect: 'error',
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Remote forward failed for ${row.id}: ${msg}`);
    return { ok: false, error: msg };
  }
}
