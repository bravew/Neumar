import type { ExternalMcpTokenMetadata } from './tokens';

export interface ExternalMcpTemplate {
  id: string;
  label: string;
  transport: 'http' | 'sse' | 'stdio';
  auth: 'oauth' | 'api-key' | 'none';
  endpoint?: string;
  description: string;
  anonymousRateLimited?: boolean;
}

export const DESIGN_MODE_EXTERNAL_MCP_TEMPLATES: ExternalMcpTemplate[] = [
  {
    id: 'figma-context',
    label: 'Figma Context',
    transport: 'http',
    auth: 'oauth',
    endpoint: 'https://mcp.figma.com/mcp',
    description: 'Bring Figma design context into DesignMode prompts.',
  },
  {
    id: 'design-token-bridge',
    label: 'Design Token Bridge',
    transport: 'http',
    auth: 'api-key',
    description: 'Read W3C-style design tokens from a configured endpoint.',
  },
  {
    id: 'shadcn-ui',
    label: 'shadcn/ui',
    transport: 'stdio',
    auth: 'none',
    description: 'Expose component snippets and usage guidance.',
  },
  {
    id: 'storybook-extractor',
    label: 'Storybook Extractor',
    transport: 'stdio',
    auth: 'api-key',
    description: 'Import Storybook component metadata into briefs.',
  },
  {
    id: 'twenty-first-dev-magic',
    label: '21st.dev Magic',
    transport: 'http',
    auth: 'api-key',
    description: 'Generate high-quality UI candidates through a curated MCP.',
  },
  {
    id: 'mermaid',
    label: 'Mermaid',
    transport: 'stdio',
    auth: 'none',
    description: 'Render diagrams as DesignMode artifacts.',
  },
  {
    id: 'antv-chart',
    label: 'AntV Chart',
    transport: 'stdio',
    auth: 'none',
    description: 'Create charts and data visualizations.',
  },
  {
    id: 'excalidraw-architect',
    label: 'Excalidraw Architect',
    transport: 'stdio',
    auth: 'none',
    description: 'Sketch architecture diagrams and low-fidelity flows.',
  },
  {
    id: 'photopea',
    label: 'Photopea',
    transport: 'http',
    auth: 'none',
    description: 'Perform browser-based image editing tasks.',
    anonymousRateLimited: true,
  },
  {
    id: 'image-sorcery',
    label: 'ImageSorcery',
    transport: 'stdio',
    auth: 'api-key',
    description: 'Transform and inspect image assets programmatically.',
  },
  {
    id: 'higgsfield',
    label: 'Higgsfield',
    transport: 'http',
    auth: 'oauth',
    description: 'Generate image and motion assets through Higgsfield.',
  },
  {
    id: 'pollinations',
    label: 'Pollinations',
    transport: 'http',
    auth: 'none',
    description: 'Use an anonymous, rate-limited image generation fallback.',
    anonymousRateLimited: true,
  },
];

export function listExternalMcpTemplates() {
  return DESIGN_MODE_EXTERNAL_MCP_TEMPLATES;
}

export function externalMcpStatusForConfig(
  serverId: string,
  config: Record<string, unknown> | undefined,
  tokenMetadata?: ExternalMcpTokenMetadata | null,
) {
  const server = config?.[serverId];
  if (!server || typeof server !== 'object') {
    return {
      serverId,
      connected: Boolean(tokenMetadata),
      ...(tokenMetadata
        ? {
            tokenStore: 'encrypted' as const,
            expiresAt: tokenMetadata.expiresAt,
            scopes: tokenMetadata.scopes,
          }
        : {}),
    };
  }
  const value = server as {
    headers?: Record<string, string>;
    env?: Record<string, string>;
  };
  const hasBearer = Boolean(value.headers?.Authorization);
  const hasTokenEnv = Object.keys(value.env ?? {}).some((key) =>
    /token|api[_-]?key/i.test(key),
  );
  return {
    serverId,
    connected: hasBearer || hasTokenEnv || Boolean(tokenMetadata),
    ...(tokenMetadata
      ? {
          tokenStore: 'encrypted' as const,
          expiresAt: tokenMetadata.expiresAt,
          scopes: tokenMetadata.scopes,
        }
      : {}),
  };
}
