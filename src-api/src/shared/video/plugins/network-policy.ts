import {
  denyAllPolicy,
  networkPolicySchema,
  type NetworkPolicy,
} from '@/shared/network-policy/schema';

import type { VideoPluginManifest } from './validate';

export interface CompiledVideoPluginNetworkPolicy {
  policy: NetworkPolicy;
  allowedHosts: string[];
  reason?: string;
}

export function compileVideoPluginNetworkPolicy(
  manifest: VideoPluginManifest,
  options: { includeDevHosts?: boolean } = {},
): CompiledVideoPluginNetworkPolicy {
  const networkAccess = manifest.video.networkAccess;
  if (!networkAccess || isDenyAll(networkAccess.allowedHosts)) {
    return {
      policy: denyAllPolicy(),
      allowedHosts: ['none'],
      reason: networkAccess?.reason,
    };
  }

  const hosts = [
    ...networkAccess.allowedHosts,
    ...(options.includeDevHosts ? (networkAccess.devAllowedHosts ?? []) : []),
  ].filter((host) => host !== 'none');

  return {
    policy: networkPolicySchema.parse({
      version: 1,
      default: 'deny',
      egress: hosts.map((host) => ({
        name: `video-plugin-${manifest.name}-${host}`,
        host,
        ports: [443],
        methods: ['GET', 'POST'],
        paths: networkAccess.allowedPaths?.[host] ?? [],
      })),
    }),
    allowedHosts: hosts,
    reason: networkAccess.reason,
  };
}

function isDenyAll(hosts: readonly string[]): boolean {
  return hosts.length === 0 || (hosts.length === 1 && hosts[0] === 'none');
}
