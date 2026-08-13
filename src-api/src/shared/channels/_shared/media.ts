import { validateImageResponse } from '@/shared/utils/image-validator';

export interface RedirectAuthOptions {
  value: string;
  header?: string;
}

export interface DownloadWithRedirectsOptions {
  auth?: string | RedirectAuthOptions;
  hosts?: string[];
  maxRedirects?: number;
  timeoutMs?: number;
}

export function assertImage(res: Response, buffer: Buffer): { ext: string } {
  const validation = validateImageResponse(res, buffer);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }
  return { ext: validation.ext };
}

export function validateAttachmentSize(bytes: number, cap: number): void {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error('Attachment size is invalid');
  }
  if (bytes > cap) {
    throw new Error(`Attachment exceeds size cap (${bytes} > ${cap})`);
  }
}

export async function downloadWithRedirects(
  url: string,
  options: DownloadWithRedirectsOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = url;

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const res = await fetch(currentUrl, {
      headers: authHeadersFor(currentUrl, options),
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });

    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error('Too many redirects');
}

function authHeadersFor(
  url: string,
  options: DownloadWithRedirectsOptions,
): Record<string, string> {
  if (!options.auth) return {};
  if (options.hosts?.length && !hostAllowed(url, options.hosts)) return {};

  const auth =
    typeof options.auth === 'string'
      ? { header: 'Authorization', value: options.auth }
      : {
          header: options.auth.header ?? 'Authorization',
          value: options.auth.value,
        };
  return { [auth.header]: auth.value };
}

function hostAllowed(url: string, hosts: string[]): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}
