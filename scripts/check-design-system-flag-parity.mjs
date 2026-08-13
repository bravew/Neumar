import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const systemsRoot = path.join(repoRoot, 'plugins/builtin/design-systems');
const requiredStructured = new Set(['default', 'kami']);

function renderPrompt(designMd, tokenCss, componentsHtml, enabled) {
  const sections = [`## Active design system\n\n${designMd}`];
  if (enabled && tokenCss) {
    sections.push(
      `## Active design system tokens\n\n\`\`\`css\n${tokenCss}\n\`\`\``,
    );
  }
  if (enabled && componentsHtml) {
    sections.push(
      `## Reference fixture\n\n\`\`\`html\n${componentsHtml}\n\`\`\``,
    );
  }
  return sections.join('\n\n---\n\n');
}

async function readOptional(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return null;
    return readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

const entries = await readdir(systemsRoot, { withFileTypes: true });
const failures = [];

for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
  const systemRoot = path.join(systemsRoot, entry.name);
  const designPath = path.join(systemRoot, 'DESIGN.md');
  const designMd = await readFile(designPath, 'utf8');
  const tokenCss = await readOptional(path.join(systemRoot, 'tokens.css'));
  const componentsHtml = await readOptional(
    path.join(systemRoot, 'components.html'),
  );
  const hasStructuredSidecars = Boolean(tokenCss && componentsHtml);
  const flagOff = renderPrompt(designMd, tokenCss, componentsHtml, false);
  const flagOn = renderPrompt(designMd, tokenCss, componentsHtml, true);

  if (requiredStructured.has(entry.name)) {
    if (!hasStructuredSidecars) {
      failures.push(`${entry.name}: expected tokens.css and components.html`);
    } else if (flagOff === flagOn) {
      failures.push(`${entry.name}: token channel did not change the prompt`);
    }
    continue;
  }

  if (!hasStructuredSidecars && flagOff !== flagOn) {
    failures.push(`${entry.name}: prose-only prompt changed with flag on`);
  }
  if (Boolean(tokenCss) !== Boolean(componentsHtml)) {
    failures.push(
      `${entry.name}: partial token sidecar set; add both files or neither`,
    );
  }
}

if (failures.length > 0) {
  console.error('Design-system token-channel parity failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Design-system token-channel parity passed.');
