import type { LicenseInfo } from '../types';

export type AttributionFormat = 'markdown' | 'html' | 'text';

export function renderAttribution(
  licenseInfo: LicenseInfo | undefined,
  format: AttributionFormat,
): string | null {
  if (!licenseInfo) return null;

  const creator = licenseInfo.creatorName ?? 'Unknown creator';
  const source = licenseInfo.provider ?? 'source';
  const sourceUrl = licenseInfo.attributionUrl ?? licenseInfo.creatorUrl;
  const license = licenseInfo.license;
  const licenseUrl = licenseInfo.licenseUrl;

  if (licenseInfo.attributionText) {
    return renderTextWithOptionalLink(
      licenseInfo.attributionText,
      sourceUrl,
      format,
    );
  }

  const base = `Photo by ${creator} on ${source}`;
  const suffix = license ? ` (${license})` : '';
  if (format === 'text') return `${base}${suffix}`;

  const linkedBase =
    renderTextWithOptionalLink(base, sourceUrl, format) ?? base;
  if (!license) return linkedBase;

  const linkedLicense =
    renderTextWithOptionalLink(license, licenseUrl, format) ?? license;
  return `${linkedBase} (${linkedLicense})`;
}

export function appendAttribution(
  content: string,
  licenseInfo: LicenseInfo | undefined,
  format: AttributionFormat,
): string {
  const attribution = renderAttribution(licenseInfo, format);
  if (!attribution) return content;

  if (format === 'html') {
    return `${content}\n<p class="cloud-storage-attribution">${attribution}</p>`;
  }
  return `${content}\n\n${attribution}`;
}

function renderTextWithOptionalLink(
  text: string,
  url: string | undefined,
  format: AttributionFormat,
): string | null {
  if (!url) return text;
  if (format === 'markdown') return `[${text}](${url})`;
  if (format === 'html') {
    return `<a href="${escapeHtml(url)}" rel="nofollow noopener noreferrer">${escapeHtml(
      text,
    )}</a>`;
  }
  return text;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
