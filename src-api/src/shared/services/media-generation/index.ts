/**
 * Media Generation — Public API
 *
 * Re-exports everything consumers need. Internal implementation
 * details (adapters, registry) stay private.
 *
 * @module media-generation
 */

// Types
export type {
  GenerateImageParams,
  GenerateVideoParams,
  GeneratedImage,
  ImageGenerationResult,
  MediaGenerationAdapter,
  MediaProvenance,
  MediaProviderConfig,
  VideoTaskCreatedResult,
  VideoTaskStatus,
  VideoTaskStatusResult,
} from './types';

export { embedProvenance } from './provenance-writer';
export type { ProvenancePayload } from './provenance-writer';

// Router (main entry point for generation)
export {
  createVideoTask,
  generateImage,
  getVideoTaskStatus,
  isImageModel,
  isVideoModel,
  listCapabilities,
} from './router';

// Registry (for advanced use cases)
export { createAdapterForProvider, isMediaModel } from './registry';
