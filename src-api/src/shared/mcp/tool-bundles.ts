export type McpToolRisk =
  | 'read'
  | 'network_fetch'
  | 'workspace_write'
  | 'external_write'
  | 'destructive';

export interface McpToolBundle {
  id: string;
  label: string;
  risk: McpToolRisk;
  servers: readonly string[];
  trigger: RegExp;
}

export interface McpSelectionPlan {
  steps: Array<{ description: string }>;
}

export interface McpSelectionSummary {
  bundles: Array<{
    id: string;
    risk: McpToolRisk;
    servers: string[];
  }>;
  risks: McpToolRisk[];
  servers: string[];
}

export interface McpSelectionTraceAttrs {
  mcpSelection: McpSelectionSummary;
  mcpAllowedToolCount: number;
  mcpAllowedTools: string[];
}

export const MCP_TOOL_BUNDLES = [
  {
    id: 'issue-tracker',
    label: 'Issue tracker and repository work',
    risk: 'external_write',
    servers: ['linear', 'github'],
    trigger:
      /linear|github|pull\s*request|\bpr\b|issue|ticket|bug\s*track|sprint|backlog|\brepo(?:sitory)?\b/i,
  },
  {
    id: 'google-workspace',
    label: 'Google workspace',
    risk: 'external_write',
    servers: ['google'],
    trigger:
      /google|gmail|email|calendar|event|drive|sheets|spreadsheet|slides|google\s+docs|meet|google\s+photos?/i,
  },
  {
    id: 'cloud-files',
    label: 'Cloud files',
    risk: 'external_write',
    servers: ['box', 'dropbox', 'onedrive'],
    trigger:
      /\bbox\b|box\.com|dropbox|onedrive|sharepoint|one\s*drive|microsoft\s*graph|cloud\s+(file|drive|storage)/i,
  },
  {
    id: 'design-context',
    label: 'Design context',
    risk: 'network_fetch',
    servers: ['figma', 'assets', 'workspace'],
    trigger:
      /figma|design\s*(file|system|token|context)|asset|catalog|library|tagged?|saved\s+(image|video|media)|existing\s+(image|video|media)|photo\s+library|b-?roll|clip|workspace|codebase|\bdocs?\b/i,
  },
  {
    id: 'media-generation',
    label: 'Media generation',
    risk: 'workspace_write',
    servers: ['media', 'speech', 'ffmpeg', 'cloud-storage-media'],
    trigger:
      /image|video|generat|illustrat|visual|media|picture|photo|thumbnail|speech|voice|tts|stt|transcrib|synthesiz|audio.*text|text.*audio|ffmpeg|convert|transcode|trim|concat|\bgif\b|extract.*frame|video.*edit/i,
  },
  {
    id: 'memory',
    label: 'Memory',
    risk: 'read',
    servers: ['memory'],
    trigger: /memory|remember|recall|forget|long.?term/i,
  },
  {
    id: 'research',
    label: 'Search and research',
    risk: 'network_fetch',
    servers: ['search'],
    trigger:
      /search|web.*search|look\s*up|find.*online|current.*info|latest.*news|research.*web/i,
  },
  {
    id: 'publish',
    label: 'Publishing',
    risk: 'external_write',
    servers: ['publish'],
    trigger: /publish|upload|post|share|album|immich|social/i,
  },
  {
    id: 'schedule',
    label: 'Scheduling',
    risk: 'external_write',
    servers: ['schedule'],
    trigger: /schedule|remind|follow.?up|cron|automation|send\s+later/i,
  },
  {
    id: 'connectors',
    label: 'Connected apps',
    risk: 'external_write',
    servers: ['connectors'],
    trigger: /connector|composio|notion|jira|asana|salesforce|hubspot/i,
  },
] as const satisfies readonly McpToolBundle[];

export function selectMcpToolBundles(
  plan: McpSelectionPlan,
): Set<(typeof MCP_TOOL_BUNDLES)[number]['id']> {
  const allDescriptions = plan.steps.map((s) => s.description).join(' ');
  const matched = new Set<(typeof MCP_TOOL_BUNDLES)[number]['id']>();

  for (const bundle of MCP_TOOL_BUNDLES) {
    if (bundle.trigger.test(allDescriptions)) matched.add(bundle.id);
  }

  if (matched.size === 0) {
    return new Set(MCP_TOOL_BUNDLES.map((bundle) => bundle.id));
  }

  return matched;
}

export function selectMcpServers(plan: McpSelectionPlan): Set<string> {
  const selectedBundleIds = selectMcpToolBundles(plan);
  const servers = new Set<string>();

  for (const bundle of MCP_TOOL_BUNDLES) {
    if (!selectedBundleIds.has(bundle.id)) continue;
    for (const server of bundle.servers) servers.add(server);
  }

  return servers;
}

export function summarizeMcpSelection(
  selectedServers: Iterable<string>,
): McpSelectionSummary {
  const selected = new Set(selectedServers);
  const bundles = MCP_TOOL_BUNDLES.flatMap((bundle) => {
    const servers = bundle.servers.filter((server) => selected.has(server));
    return servers.length > 0
      ? [{ id: bundle.id, risk: bundle.risk, servers }]
      : [];
  });
  const risks = [...new Set(bundles.map((bundle) => bundle.risk))].sort();
  const servers = [...selected].sort();
  return { bundles, risks, servers };
}

export function mcpAllowedToolNames(
  server: string,
  toolNames: readonly string[],
): string[] {
  return toolNames.map((toolName) => `mcp__${server}__${toolName}`);
}

export function mcpSelectionTraceAttrs(
  selectedServers: Iterable<string>,
  allowedTools: Iterable<string>,
  maxAllowedTools = 200,
): McpSelectionTraceAttrs {
  const mcpAllowedTools = [...allowedTools]
    .filter((toolName) => toolName.startsWith('mcp__'))
    .sort();
  return {
    mcpSelection: summarizeMcpSelection(selectedServers),
    mcpAllowedToolCount: mcpAllowedTools.length,
    mcpAllowedTools: mcpAllowedTools.slice(0, maxAllowedTools),
  };
}
