import { nanoid } from 'nanoid';

export function makeSessionId(): string {
  return `session-${nanoid(8)}`;
}

export function makeTaskId(): string {
  return `task-${nanoid(8)}`;
}

export function makeProviderConfig(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'claude',
    apiKey: 'sk-test-key',
    model: 'claude-3-5-sonnet-20241022',
    ...overrides,
  };
}

export function makeAutomationId(): string {
  return `auto-${nanoid(8)}`;
}

export function makeProjectId(): string {
  return `proj-${nanoid(8)}`;
}

export function makeProfileId(): string {
  return `prof-${nanoid(8)}`;
}

export function makeMemoryId(): string {
  return `mem-${nanoid(8)}`;
}

export function createTestAutomation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: makeAutomationId(),
    name: `test-automation-${nanoid(6)}`,
    enabled: true,
    trigger: { type: 'manual' },
    action: { type: 'agent', prompt: 'Test automation task' },
    ...overrides,
  };
}

export function createTestMemory(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: makeMemoryId(),
    content: `Test memory content ${nanoid(6)}`,
    type: 'note',
    tags: ['test'],
    ...overrides,
  };
}

export function createTestProject(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: makeProjectId(),
    name: `test-project-${nanoid(6)}`,
    description: 'Test project for integration tests',
    ...overrides,
  };
}

export function createTestProfile(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: makeProfileId(),
    name: `test-profile-${nanoid(6)}`,
    model: 'claude-3-5-sonnet-20241022',
    status: 'active',
    ...overrides,
  };
}
