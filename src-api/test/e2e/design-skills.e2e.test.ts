import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getJson } from '../helpers/http-client';
import {
  spawnApiInstance,
  stopApiInstance,
  type ApiInstance,
} from '../helpers/spawn-api';

interface DesignSkill {
  id: string;
  slug: string;
  origin?: string;
  od?: { surface?: string };
}

describe('DesignMode skills E2E', () => {
  let api: ApiInstance;

  beforeAll(async () => {
    api = await spawnApiInstance('design-skills');
  });

  afterAll(async () => {
    await stopApiInstance(api);
  });

  it('serves the bundled glass-dashboard skill from /design/skills', async () => {
    const { status, json } = await getJson(api.baseUrl, '/design/skills');
    expect(status).toBe(200);

    const skills = (json as { skills: DesignSkill[] }).skills;
    expect(Array.isArray(skills)).toBe(true);

    const glass = skills.find((s) => s.id === 'bundled:glass-dashboard');
    expect(glass, 'bundled:glass-dashboard').toBeTruthy();
    expect(glass?.slug).toBe('glass-dashboard');
    expect(glass?.od?.surface).toBe('prototype');
  });

  it('serves the self-contained glass-dashboard example over HTTP', async () => {
    // The example route returns raw HTML (not JSON).
    const res = await fetch(
      `${api.baseUrl}/design/skills/bundled:glass-dashboard/example`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const example = await res.text();
    expect(example).toContain('<!doctype html>');
    expect(example).not.toMatch(/https?:\/\//);
  });
});
