export type Capability = `${string}:${string}`;

export const TRUST_TIERS = [
  'bundled',
  'saved',
  'local',
  'imported',
  'marketplace',
  'github',
  'url',
] as const;

export type TrustTier = (typeof TRUST_TIERS)[number];

export type CapabilityRisk = 'low' | 'medium' | 'high';

export type DefaultGrantPolicy =
  | 'always'
  | 'trusted'
  | 'reviewed'
  | 'explicit'
  | 'never';

export interface CapabilityDefinition {
  id: Capability;
  domain: string;
  title: string;
  description: string;
  risk: CapabilityRisk;
  defaultGrant: DefaultGrantPolicy;
  toolNames?: readonly string[];
}

export interface CapabilityGrant {
  capability: Capability;
  granted: boolean;
  reason: string;
  requiresExplicitApproval: boolean;
}

export interface CapabilityGateInput {
  requested: readonly Capability[];
  trustTier: TrustTier;
  manifestDigest?: string | null;
  lastReviewedDigest?: string | null;
  signatureOk?: boolean | null;
  approvedCapabilities?: readonly Capability[];
}

const definitions = new Map<Capability, CapabilityDefinition>();

const HOST_CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: 'prompt:inject',
    domain: 'host',
    title: 'Prompt guidance',
    description: 'Inject reviewed plugin guidance into the agent prompt.',
    risk: 'low',
    defaultGrant: 'always',
  },
  {
    id: 'fs:write',
    domain: 'host',
    title: 'File writes',
    description: 'Write files outside the domain-owned project artifact path.',
    risk: 'high',
    defaultGrant: 'explicit',
  },
];

export function registerCapability(
  definition: CapabilityDefinition,
): CapabilityDefinition {
  definitions.set(definition.id, definition);
  return definition;
}

export function registerCapabilities(
  nextDefinitions: readonly CapabilityDefinition[],
): void {
  for (const definition of nextDefinitions) {
    registerCapability(definition);
  }
}

export function getCapabilityDefinition(
  capability: Capability,
): CapabilityDefinition | undefined {
  ensureHostCapabilitiesRegistered();
  return definitions.get(capability);
}

export function listCapabilityDefinitions(): CapabilityDefinition[] {
  ensureHostCapabilitiesRegistered();
  return [...definitions.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function resetCapabilityRegistryForTests(): void {
  definitions.clear();
}

export function ensureHostCapabilitiesRegistered(): void {
  for (const definition of HOST_CAPABILITIES) {
    if (!definitions.has(definition.id)) {
      definitions.set(definition.id, definition);
    }
  }
}

export function computeCapabilityGrants(
  input: CapabilityGateInput,
): CapabilityGrant[] {
  ensureHostCapabilitiesRegistered();

  const approved = new Set(input.approvedCapabilities ?? []);
  const reviewed =
    Boolean(input.manifestDigest) &&
    input.manifestDigest === input.lastReviewedDigest;
  const trustedTier =
    input.trustTier === 'bundled' || input.trustTier === 'saved';
  const signatureTrusted = input.signatureOk !== false;

  return Array.from(new Set(input.requested)).map((capability) => {
    const definition = definitions.get(capability);
    if (!definition) {
      return {
        capability,
        granted: false,
        reason: `Unknown capability "${capability}"`,
        requiresExplicitApproval: true,
      };
    }

    if (approved.has(capability)) {
      return {
        capability,
        granted: true,
        reason: 'Capability explicitly approved for this run',
        requiresExplicitApproval: false,
      };
    }

    switch (definition.defaultGrant) {
      case 'always':
        return {
          capability,
          granted: true,
          reason: 'Capability is always allowed',
          requiresExplicitApproval: false,
        };
      case 'trusted':
        return {
          capability,
          granted: (trustedTier || reviewed) && signatureTrusted,
          reason:
            trustedTier && signatureTrusted
              ? `Trust tier "${input.trustTier}" grants this capability`
              : reviewed && signatureTrusted
                ? 'Manifest digest has been reviewed'
                : input.signatureOk === false
                  ? 'Capability requires a valid plugin signature'
                  : 'Capability requires a bundled/saved trusted plugin or reviewed manifest digest',
          requiresExplicitApproval: !(
            (trustedTier || reviewed) &&
            signatureTrusted
          ),
        };
      case 'reviewed':
        return {
          capability,
          granted: reviewed && signatureTrusted,
          reason:
            reviewed && signatureTrusted
              ? 'Manifest digest has been reviewed'
              : 'Capability requires review of the current manifest digest',
          requiresExplicitApproval: !(reviewed && signatureTrusted),
        };
      case 'explicit':
        return {
          capability,
          granted: false,
          reason: 'Capability requires explicit run-time approval',
          requiresExplicitApproval: true,
        };
      case 'never':
        return {
          capability,
          granted: false,
          reason: 'Capability is not grantable by policy',
          requiresExplicitApproval: false,
        };
      default: {
        const exhaustive: never = definition.defaultGrant;
        return exhaustive;
      }
    }
  });
}

export function filterAllowedToolsByCapabilities(
  allowedTools: readonly string[],
  grants: readonly CapabilityGrant[],
): string[] {
  ensureHostCapabilitiesRegistered();
  const granted = new Set(
    grants.filter((grant) => grant.granted).map((grant) => grant.capability),
  );
  const toolToCapability = new Map<string, Capability>();
  for (const definition of definitions.values()) {
    for (const toolName of definition.toolNames ?? []) {
      toolToCapability.set(toolName, definition.id);
    }
  }

  return allowedTools.filter((toolName) => {
    const required = toolToCapability.get(toolName);
    return !required || granted.has(required);
  });
}
