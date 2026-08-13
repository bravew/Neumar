/**
 * Per-connector curated tool allow-lists.
 *
 * Composio toolkits frequently ship 100–300 tools per provider. Surfacing
 * all of them to the agent inflates `connectors_list` payloads (every
 * entry costs tokens) and degrades tool-selection accuracy. We curate a
 * small, opinionated read-first set per popular connector — the same
 * pattern the open-design sample uses for `personal_daily_digest`.
 *
 * `connectors_list` filters to the curated names by default; agents can
 * pass `{ includeAll: true }` to escape-hatch into the full Composio
 * surface. The binder still gates per-tool safety/approval at execute
 * time, so this is purely about context economy.
 *
 * Each entry uses the namespaced tool name as it appears post-hydration
 * (`<connectorId>.<COMPOSIO_TOOL_SLUG>`).
 */
export const COMPOSIO_CURATED_TOOLS: Record<string, readonly string[]> = {
  // Box, Dropbox, OneDrive intentionally omitted — those go through
  // first-party OAuth + direct REST adapters now, not Composio.
  googledrive: [
    'googledrive.GOOGLEDRIVE_LIST_FILES',
    'googledrive.GOOGLEDRIVE_SEARCH_FILES',
    'googledrive.GOOGLEDRIVE_GET_FILE_METADATA',
    'googledrive.GOOGLEDRIVE_DOWNLOAD_FILE',
    'googledrive.GOOGLEDRIVE_UPLOAD_FILE',
    'googledrive.GOOGLEDRIVE_CREATE_FOLDER',
    'googledrive.GOOGLEDRIVE_DELETE_FILE',
    'googledrive.GOOGLEDRIVE_SHARE_FILE',
  ],
};

export const COMPOSIO_FEATURED_TOOLS: Record<string, readonly string[]> = {
  googledrive: [
    'googledrive.GOOGLEDRIVE_SEARCH_FILES',
    'googledrive.GOOGLEDRIVE_LIST_FILES',
  ],
};

export function curatedToolsFor(connectorId: string): readonly string[] {
  return COMPOSIO_CURATED_TOOLS[connectorId] ?? [];
}

export function featuredToolsFor(connectorId: string): readonly string[] {
  return COMPOSIO_FEATURED_TOOLS[connectorId] ?? [];
}
