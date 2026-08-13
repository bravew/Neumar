import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const panelPath = path.join(
  repoRoot,
  'src/components/design/MediaModelCards.tsx',
);
const required = new Map([
  [
    'elevenlabs-speech',
    'src-api/src/shared/services/speech/adapters/elevenlabs.ts',
  ],
  [
    'elevenlabs-sfx',
    'src-api/src/shared/services/speech/adapters/elevenlabs-sfx.ts',
  ],
  [
    'senseaudio-tts',
    'src-api/src/shared/services/speech/adapters/senseaudio.ts',
  ],
  ['gpt-4o-mini-tts', 'src-api/src/shared/services/speech/adapters/openai.ts'],
  [
    'gpt-image-2',
    'src-api/src/shared/services/media-generation/adapters/openai.ts',
  ],
  [
    'seedream-5.0',
    'src-api/src/shared/services/media-generation/adapters/byteplus.ts',
  ],
  [
    'seedance-2.0',
    'src-api/src/shared/services/media-generation/adapters/byteplus.ts',
  ],
  [
    'leonardo-phoenix',
    'src-api/src/shared/services/media-generation/adapters/leonardo.ts',
  ],
  [
    'leonardo-kino-xl',
    'src-api/src/shared/services/media-generation/adapters/leonardo.ts',
  ],
  [
    'leonardo-flux-dev',
    'src-api/src/shared/services/media-generation/adapters/leonardo.ts',
  ],
  [
    'leonardo-flux-schnell',
    'src-api/src/shared/services/media-generation/adapters/leonardo.ts',
  ],
  [
    'leonardo-anime-pastel',
    'src-api/src/shared/services/media-generation/adapters/leonardo.ts',
  ],
  [
    'imagerouter:image',
    'src-api/src/shared/services/media-generation/adapters/openai-compatible.ts',
  ],
  [
    'imagerouter:video',
    'src-api/src/shared/services/media-generation/adapters/openai-compatible.ts',
  ],
  [
    'custom-image:default',
    'src-api/src/shared/services/media-generation/adapters/openai-compatible.ts',
  ],
  [
    'hyperframes-html',
    'src-api/src/shared/services/design-mode/media-dispatcher.ts',
  ],
]);

const source = await readFile(panelPath, 'utf8');
const uiIds = new Set(
  [...source.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((match) => match[1]),
);
const failures = [];

for (const [id, file] of required) {
  try {
    await access(path.join(repoRoot, file));
  } catch {
    failures.push(`${id}: expected backend file is missing (${file})`);
  }
  if (!uiIds.has(id)) {
    failures.push(`${id}: missing from NewProjectPanel model catalog`);
  }
}

for (const id of uiIds) {
  if (!required.has(id)) {
    failures.push(`${id}: model catalog entry has no drift-check mapping`);
  }
}

if (failures.length > 0) {
  console.error('Design media catalog drift check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Design media catalog drift check passed.');
