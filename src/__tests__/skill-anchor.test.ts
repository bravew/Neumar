import { describe, expect, it } from 'vitest';

import { parseSkillAnchor, stripSkillAnchor } from '@/shared/lib/skill-anchor';

describe('parseSkillAnchor', () => {
  it('lifts a leading Skill: <slug> anchor off the body', () => {
    const r = parseSkillAnchor(
      'Skill: example-skill\n\nHello! I can help with that.',
    );
    expect(r.skill).toBe('example-skill');
    expect(r.body).toBe('Hello! I can help with that.');
  });

  it('handles a trailing parenthetical note on the anchor line', () => {
    const r = parseSkillAnchor(
      'Skill: example-skill (discipline anchor)\nHi there',
    );
    expect(r.skill).toBe('example-skill');
    expect(r.body).toBe('Hi there');
  });

  it('returns the text unchanged when there is no anchor', () => {
    const text = 'Just a normal reply about React.';
    const r = parseSkillAnchor(text);
    expect(r.skill).toBeNull();
    expect(r.body).toBe(text);
  });

  it('does not match a line that merely mentions a skill', () => {
    // Capitalized value + trailing prose → not a standalone anchor.
    const text = 'Skill: React is a UI library, not a skill anchor.';
    expect(parseSkillAnchor(text).skill).toBeNull();
    expect(stripSkillAnchor(text)).toBe(text);
  });

  it('does not strip an anchor that is not at the very start', () => {
    const text = 'Here is a note.\nSkill: example-skill';
    expect(parseSkillAnchor(text).skill).toBeNull();
  });

  it('handles empty input', () => {
    expect(parseSkillAnchor('').skill).toBeNull();
    expect(stripSkillAnchor('')).toBe('');
  });
});
