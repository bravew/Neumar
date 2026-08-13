import type { AgentConfig, AgentProvider, AgentTransport } from './types';

export type HarnessCapability =
  | 'tools'
  | 'streaming'
  | 'vision'
  | 'reasoning'
  | 'skills'
  | 'mcp';

export interface HarnessProfile {
  id: string;
  provider: AgentProvider;
  modelPattern?: RegExp;
  transport?: AgentTransport;
  priority?: number;
  capabilities: Partial<Record<HarnessCapability, boolean>>;
  defaults?: Partial<AgentConfig>;
  limits?: {
    maxTurns?: number;
    maxOutputTokens?: number;
  };
}

export interface HarnessProfileInput {
  provider: AgentProvider;
  model?: string;
  transport?: AgentTransport;
  profileId?: string;
}

export function mergeHarnessProfiles(
  base: HarnessProfile,
  override: Partial<HarnessProfile>,
): HarnessProfile {
  return {
    ...base,
    ...override,
    capabilities: {
      ...base.capabilities,
      ...override.capabilities,
    },
    defaults: {
      ...base.defaults,
      ...override.defaults,
    },
    limits: {
      ...base.limits,
      ...override.limits,
    },
  };
}

export class HarnessProfileRegistry {
  private readonly profiles = new Map<string, HarnessProfile>();

  register(profile: HarnessProfile): void {
    this.profiles.set(profile.id, profile);
  }

  get(id: string): HarnessProfile | undefined {
    return this.profiles.get(id);
  }

  resolve(input: HarnessProfileInput): HarnessProfile | undefined {
    if (input.profileId) {
      const explicit = this.profiles.get(input.profileId);
      if (explicit) return explicit;
    }

    const matches = Array.from(this.profiles.values())
      .filter((profile) => profile.provider === input.provider)
      .filter(
        (profile) =>
          !profile.transport || input.transport === profile.transport,
      )
      .filter(
        (profile) =>
          !profile.modelPattern || profile.modelPattern.test(input.model ?? ''),
      )
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    return matches.reduce<HarnessProfile | undefined>(
      (merged, profile) =>
        merged ? mergeHarnessProfiles(merged, profile) : profile,
      undefined,
    );
  }

  list(): HarnessProfile[] {
    return Array.from(this.profiles.values());
  }
}

export const harnessProfileRegistry = new HarnessProfileRegistry();

export const BUILTIN_HARNESS_PROFILES: HarnessProfile[] = [
  {
    id: 'claude-sdk-default',
    provider: 'claude',
    transport: 'sdk',
    priority: 0,
    capabilities: {
      tools: true,
      streaming: true,
      vision: true,
      reasoning: false,
      skills: true,
      mcp: true,
    },
  },
  {
    id: 'claude-sdk-reasoning',
    provider: 'claude',
    transport: 'sdk',
    priority: 10,
    modelPattern: /claude.*(opus|sonnet-4|claude-4)/i,
    capabilities: {
      reasoning: true,
    },
  },
  {
    id: 'codex-cli-default',
    provider: 'codex',
    transport: 'cli',
    priority: 0,
    capabilities: {
      tools: true,
      streaming: true,
      reasoning: true,
      skills: false,
      mcp: false,
    },
  },
];

for (const profile of BUILTIN_HARNESS_PROFILES) {
  harnessProfileRegistry.register(profile);
}

export function resolveHarnessProfile(
  input: HarnessProfileInput,
): HarnessProfile | undefined {
  return harnessProfileRegistry.resolve(input);
}

export function applyHarnessProfileToConfig(config: AgentConfig): AgentConfig {
  const provider = config.agentType ?? config.provider;
  const profile = resolveHarnessProfile({
    provider,
    model: config.model,
    transport: config.harnessTransport,
    profileId: config.harnessProfileId,
  });
  if (!profile?.defaults) return config;
  return {
    ...profile.defaults,
    ...config,
    provider: config.provider,
    providerConfig: {
      ...profile.defaults.providerConfig,
      ...config.providerConfig,
    },
  };
}

export function hasHarnessCapability(
  input: HarnessProfileInput,
  capability: HarnessCapability,
): boolean {
  return resolveHarnessProfile(input)?.capabilities[capability] === true;
}
