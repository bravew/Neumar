import { API_BASE_URL } from '@/config';

export function resolveTemplatePosterUrl(
  posterUrl: string | null | undefined,
): string | null {
  if (!posterUrl) return null;
  if (/^https?:\/\//i.test(posterUrl)) return posterUrl;
  return `${API_BASE_URL}${posterUrl.startsWith('/') ? '' : '/'}${posterUrl}`;
}
