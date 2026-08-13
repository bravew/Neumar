/**
 * Shared BlueBubbles server probe.
 *
 * Used by the iMessage adapter at connect-time and by the channels admin
 * route's token validator. Returns a normalised result so callers can
 * decide whether to log a warning or surface an error to the operator.
 */

export interface ProbeResult {
  ok: boolean;
  /** Populated on failure with a short, operator-readable reason. */
  error?: string;
  /** Server host on success — useful for the validate-token info payload. */
  host?: string;
  version?: string;
  accountState?: string;
}

export interface ProbeOptions {
  serverUrl: string;
  password: string;
  /** Default 15s — long enough for a slow LAN, short enough not to hang the UI. */
  timeoutMs?: number;
}

export async function probeBlueBubbles({
  serverUrl,
  password,
  timeoutMs = 15_000,
}: ProbeOptions): Promise<ProbeResult> {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return { ok: false, error: 'Invalid serverUrl' };
  }

  try {
    // BlueBubbles' Express middleware checks query.password, body.password,
    // and the lowercase `password` header. We use the header to keep the
    // secret out of access logs and proxy URL captures.
    const res = await fetch(`${url.origin}/api/v1/server/info`, {
      headers: { password },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `BlueBubbles probe failed: ${res.status} ${res.statusText}`,
      };
    }
    const payload = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const data =
      payload && typeof payload.data === 'object' && payload.data !== null
        ? (payload.data as Record<string, unknown>)
        : payload;
    const version =
      stringValue(data, 'serverVersion') ??
      stringValue(data, 'version') ??
      stringValue(data, 'appVersion');
    const accountState =
      stringValue(data, 'iMessageAccount') ??
      stringValue(data, 'accountState') ??
      stringValue(data, 'privateApiStatus');
    return {
      ok: true,
      host: url.host,
      ...(version ? { version } : {}),
      ...(accountState ? { accountState } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `BlueBubbles unreachable: ${err.message}`
          : 'BlueBubbles unreachable',
    };
  }
}

function stringValue(
  value: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const item = value?.[key];
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean')
    return String(item);
  return undefined;
}
