import { describe, expect, it } from 'vitest';

import { parseProvenanceDisclosure } from '@/components/design/AssetProvenanceDialog';

describe('parseProvenanceDisclosure', () => {
  it('parses plain and markdown-bold labels', () => {
    expect(
      parseProvenanceDisclosure(
        [
          'Provider: OpenAI',
          '**Model:** gpt-image',
          '**Prompt hash**: abc',
        ].join('\n'),
      ),
    ).toEqual([
      { label: 'Provider', value: 'OpenAI' },
      { label: 'Model', value: 'gpt-image' },
      { label: 'Prompt hash', value: 'abc' },
    ]);
  });
});
