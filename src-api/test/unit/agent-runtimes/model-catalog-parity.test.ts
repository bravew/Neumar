import { describe, expect, it } from 'vitest';

import { getAgentDef } from '@/shared/agent-runtimes';

import {
  CLAUDE_MODELS,
  CODEX_MODELS,
} from '../../../../src/components/shared/model-catalog.data';

/**
 * Ids that exist only as CLI convenience aliases or the synthetic
 * "unset" row — never meant to appear as a selectable row in the chat
 * model picker, so they are exempt from the parity check below.
 */
const NON_SELECTABLE_IDS = new Set([
  'default',
  'best',
  'sonnet',
  'opus',
  'haiku',
]);

/**
 * The chat composer's model dropdown (`ChatInput.types.ts`) hand-curates
 * Claude/Sonnet labels and descriptions instead of reading the live
 * `/agent-runtimes` probe (see `runtime-model-catalog.ts`, which only trusts
 * a `source: 'discovered'` probe over this curated list). That curation is a
 * second, independently-maintained copy of the agent-runtime registry's
 * `fallbackModels` — this test catches the two drifting apart, which already
 * happened once (Fable 5 shipped in the registry but never reached the chat
 * picker).
 */
/**
 * A registry id counts as covered when a picker id matches exactly or is a
 * more specific, dated variant of it (e.g. registry `claude-haiku-4-5` vs.
 * picker `claude-haiku-4-5-20251001` — the picker intentionally pins the
 * dated release id, which is still the same model).
 */
function isCovered(registryId: string, pickerIds: readonly string[]): boolean {
  return pickerIds.some(
    (id) => id === registryId || id.startsWith(`${registryId}-`),
  );
}

describe('chat model picker / agent-runtime registry parity', () => {
  it('keeps every Claude fallback model selectable in the chat picker', () => {
    const claudeDef = getAgentDef('claude');
    if (!claudeDef) throw new Error('claude agent-runtime def not found');

    const registryIds = claudeDef.fallbackModels
      .map((model) => model.id)
      .filter((id) => !NON_SELECTABLE_IDS.has(id));
    const pickerIds = CLAUDE_MODELS.map((model) => model.id);

    for (const id of registryIds) {
      expect(
        isCovered(id, pickerIds),
        `"${id}" is in the claude agent-runtime registry but missing from CLAUDE_MODELS (src/components/shared/model-catalog.data.ts)`,
      ).toBe(true);
    }
  });

  it('keeps every Codex fallback model selectable in the chat picker', () => {
    const codexDef = getAgentDef('codex');
    if (!codexDef) throw new Error('codex agent-runtime def not found');

    const registryIds = codexDef.fallbackModels
      .map((model) => model.id)
      .filter((id) => !NON_SELECTABLE_IDS.has(id));
    const pickerIds = CODEX_MODELS.map((model) =>
      model.id.replace(/^codex:/, ''),
    );

    for (const id of registryIds) {
      expect(
        isCovered(id, pickerIds),
        `"${id}" is in the codex agent-runtime registry but missing from CODEX_MODELS (src/components/shared/model-catalog.data.ts)`,
      ).toBe(true);
    }
  });
});
