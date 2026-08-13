/**
 * Channel Registry — Self-Registration Pattern
 *
 * Each adapter registers itself at module load time.
 * No central registry to maintain.
 */

import { createLogger } from '@/shared/utils/logger';

import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelConfig,
} from './types';

const logger = createLogger('ChannelRegistry');

type ChannelFactory = (config: ChannelConfig) => ChannelAdapter | null;

interface ChannelMetadata {
  capabilities?: ChannelCapabilities;
}

const registry = new Map<string, ChannelFactory>();
const metadataRegistry = new Map<string, ChannelMetadata>();

export function registerChannel(
  id: string,
  factory: ChannelFactory,
  metadata: ChannelMetadata = {},
): void {
  if (registry.has(id)) {
    logger.warn(`Channel '${id}' already registered, overwriting`);
  }
  registry.set(id, factory);
  metadataRegistry.set(id, metadata);
  logger.debug(`Channel '${id}' registered`);
}

export function createChannel(
  id: string,
  config: ChannelConfig,
): ChannelAdapter | null {
  const factory = registry.get(id);
  if (!factory) {
    logger.warn(`No factory registered for channel '${id}'`);
    return null;
  }
  if (!config.enabled) {
    logger.warn(`Channel '${id}' skipped: not enabled`);
    return null;
  }
  const adapter = factory(config);
  if (!adapter) {
    logger.warn(`Channel '${id}' factory returned null (missing credentials?)`);
  }
  return adapter;
}

export function createChannels(
  configs: Record<string, ChannelConfig>,
): ChannelAdapter[] {
  const channels: ChannelAdapter[] = [];
  for (const [id, factory] of registry) {
    const config = configs[id];
    if (config?.enabled) {
      const adapter = factory(config);
      if (adapter) {
        channels.push(adapter);
        logger.info(`Channel '${id}' created`);
      }
    }
  }
  return channels;
}

export function getRegisteredChannelIds(): string[] {
  return Array.from(registry.keys());
}

export function getRegisteredChannelMetadata(
  id: string,
): ChannelMetadata | undefined {
  return metadataRegistry.get(id);
}
