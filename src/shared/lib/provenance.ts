/**
 * Media provenance — shared frontend utilities.
 *
 * The backend MCP media server embeds generator disclosure as an HTML comment
 * (`<!--neuma:provenance {json}-->`) next to each file-path line. This module
 * is the single definition of the tag name, regex, and TypeScript shape so
 * every consumer (markdown preprocessor, message bubble parser, lightbox
 * badge) agrees on the wire format.
 */

export const PROVENANCE_COMMENT_TAG = 'neuma:provenance';

/**
 * Shared provenance-comment regex with the `g` flag set.
 *
 * ⚠️ Use ONLY with `.matchAll()` or `.replace()` (stateless against a shared
 * instance). Never call `.test()` or `.exec()` on this value — both advance
 * the hidden `lastIndex` and the next caller will silently skip matches.
 * If you need stateful matching, construct a local `new RegExp(…, 'gi')`.
 */
export const PROVENANCE_COMMENT_RE = /<!--neuma:provenance\s+([\s\S]*?)-->/gi;

export interface MediaProvenanceInfo {
  provider?: string;
  model?: string;
  requestedProvider?: string;
  requestedModel?: string;
  fallbackReason?: string;
}

export interface MediaAsset {
  path: string;
  provenance?: MediaProvenanceInfo;
}
