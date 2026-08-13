export function escapeXmlText(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function escapeXmlAttr(value: unknown): string {
  return escapeXmlText(value);
}

export function xmlAttrs(
  attrs: Record<string, string | number | boolean | undefined>,
): string {
  return Object.entries(attrs)
    .filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined,
    )
    .map(([key, value]) => ` ${key}="${escapeXmlAttr(value)}"`)
    .join('');
}

export function xmlElement(
  name: string,
  attrs: Record<string, string | number | boolean | undefined>,
  children: string | string[] = '',
): string {
  const body = Array.isArray(children) ? children.join('') : children;
  if (!body) return `<${name}${xmlAttrs(attrs)}/>`;
  return `<${name}${xmlAttrs(attrs)}>${body}</${name}>`;
}
