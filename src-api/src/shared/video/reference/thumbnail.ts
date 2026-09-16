export function renderFrameworkThumbnailSvg(
  sections: Array<{ role: string; timing: { proportion: number } }>,
): string {
  const width = 640;
  const height = 360;
  let x = 24;
  const innerWidth = width - 48;
  const bars = sections.map((section, index) => {
    const w = Math.max(8, section.timing.proportion * innerWidth);
    const hue = (index * 47) % 360;
    const rect = `<rect x="${x.toFixed(1)}" y="120" width="${w.toFixed(1)}" height="120" rx="6" fill="hsl(${hue} 45% 42%)" />
    <text x="${(x + w / 2).toFixed(1)}" y="300" text-anchor="middle" fill="#e7e5e4" font-size="14" font-family="system-ui">${escapeXml(section.role)}</text>`;
    x += w;
    return rect;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#18181b"/>
  <text x="24" y="48" fill="#fafafa" font-size="20" font-family="system-ui">Framework</text>
  ${bars.join('\n  ')}
</svg>
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
