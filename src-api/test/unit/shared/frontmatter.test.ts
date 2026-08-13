import { describe, expect, it } from 'vitest';

import {
  extractFrontmatter,
  extractIndentedBlock,
  parseMarkdownFrontmatter,
  readFrontmatterBlockScalar,
  readFrontmatterScalar,
  readFrontmatterStringList,
} from '@/shared/utils/frontmatter';

describe('frontmatter parser', () => {
  it('keeps a lone quote scalar literal', () => {
    const parsed = parseMarkdownFrontmatter(`---
name: Quote Skill
description: "
---

Body`);

    expect(parsed?.attributes.description).toBe('"');
  });

  it('unquotes normal single and double quoted scalars', () => {
    const parsed = parseMarkdownFrontmatter(`---
name: "Quoted Skill"
description: 'Quoted description'
---

Body`);

    expect(parsed?.attributes.name).toBe('Quoted Skill');
    expect(parsed?.attributes.description).toBe('Quoted description');
  });

  it('preserves literal block scalar lines', () => {
    const parsed = parseMarkdownFrontmatter(`---
description: |
  First line
  Second line
---

Body`);

    expect(parsed?.attributes.description).toBe('First line\nSecond line');
  });

  it('parses simple inline and indented lists', () => {
    const markdown = `---
tags: [design, "media"]
od:
  capabilities_required:
    - image
    - "video"
---

Body`;
    const frontmatter = extractFrontmatter(markdown);
    const od = extractIndentedBlock(frontmatter, 'od');

    expect(parseMarkdownFrontmatter(markdown)?.attributes.tags).toEqual([
      'design',
      'media',
    ]);
    expect(readFrontmatterStringList(od, 'capabilities_required')).toEqual([
      'image',
      'video',
    ]);
  });

  it('keeps quoted commas inside inline list values', () => {
    const parsed = parseMarkdownFrontmatter(`---
tags: ["hello, world", 'foo, bar', baz]
---

Body`);

    expect(parsed?.attributes.tags).toEqual([
      'hello, world',
      'foo, bar',
      'baz',
    ]);
  });

  it('reads nested scalar and block scalar values', () => {
    const frontmatter = extractFrontmatter(`---
od:
  mode: image
  example_prompt: |
    Create a poster.
---

Body`);
    const od = extractIndentedBlock(frontmatter, 'od');

    expect(readFrontmatterScalar(od, 'mode')).toBe('image');
    expect(readFrontmatterBlockScalar(od, 'example_prompt')).toBe(
      'Create a poster.',
    );
  });
});
