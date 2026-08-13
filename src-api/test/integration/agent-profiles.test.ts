import crypto from 'crypto';

import { describe, expect, it } from 'vitest';

import {
  createAgentProfile,
  deleteAgentProfile,
  getAgentProfile,
  getAllAgentProfiles,
  updateAgentProfile,
} from '@/shared/db/operations';

describe('Agent Profiles', () => {
  const makeProfile = (overrides?: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    name: 'Test Profile',
    runtime_id: 'claude',
    ...overrides,
  });

  describe('CRUD', () => {
    it('creates an agent profile', () => {
      const input = makeProfile({ name: 'CRUD-Create' });
      const profile = createAgentProfile(input);
      expect(profile.id).toBe(input.id);
      expect(profile.name).toBe('CRUD-Create');
      expect(profile.runtime_id).toBe('claude');
      expect(profile.status).toBe('active');
      expect(profile.max_delegation_depth).toBe(3);
      expect(profile.max_concurrent_tasks).toBe(1);
    });

    it('reads an agent profile', () => {
      const input = makeProfile({ name: 'CRUD-Read' });
      createAgentProfile(input);
      const profile = getAgentProfile(input.id);
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe('CRUD-Read');
    });

    it('updates an agent profile', () => {
      const input = makeProfile({ name: 'CRUD-Update' });
      createAgentProfile(input);
      const updated = updateAgentProfile(input.id, {
        name: 'Updated Name',
        role: 'researcher',
      });
      expect(updated.name).toBe('Updated Name');
      expect(updated.role).toBe('researcher');
    });

    it('deletes an agent profile', () => {
      const input = makeProfile({ name: 'CRUD-Delete' });
      createAgentProfile(input);
      deleteAgentProfile(input.id);
      const profile = getAgentProfile(input.id);
      expect(profile).toBeNull();
    });
  });

  describe('Status transitions', () => {
    it('supports active → paused → archived', () => {
      const input = makeProfile();
      const profile = createAgentProfile(input);
      expect(profile.status).toBe('active');

      const paused = updateAgentProfile(input.id, {
        status: 'paused',
      });
      expect(paused.status).toBe('paused');

      const archived = updateAgentProfile(input.id, {
        status: 'archived',
      });
      expect(archived.status).toBe('archived');
    });
  });

  describe('List with status filter', () => {
    it('filters by status', () => {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      createAgentProfile({
        id: id1,
        name: 'Active One',
        runtime_id: 'claude',
      });
      createAgentProfile({
        id: id2,
        name: 'Paused One',
        runtime_id: 'claude',
      });
      updateAgentProfile(id2, { status: 'paused' });

      const active = getAllAgentProfiles('active');
      expect(active.some((p) => p.id === id1)).toBe(true);
      expect(active.some((p) => p.id === id2)).toBe(false);

      const paused = getAllAgentProfiles('paused');
      expect(paused.some((p) => p.id === id2)).toBe(true);
    });
  });
});
