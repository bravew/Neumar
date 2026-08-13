import type {
  AIProvider,
  ModelRouteConfig,
  ModelRoutingConfig,
  Settings as SettingsType,
  TaskType,
} from '@/shared/db/settings';

export type {
  SettingsType,
  AIProvider,
  ModelRoutingConfig,
  ModelRouteConfig,
  TaskType,
};

// Settings category type
export type SettingsCategory =
  | 'account'
  | 'general'
  | 'workplace'
  | 'model'
  | 'agentRuntimes'
  | 'mcp'
  | 'skills'
  | 'plugins'
  | 'modes'
  | 'pets'
  | 'designMode'
  | 'connector'
  | 'channels'
  | 'memory'
  | 'speech'
  | 'search'
  | 'keyboard'
  | 'publish'
  | 'usage'
  | 'data'
  | 'about'
  | 'theme'
  | 'profiles'
  | 'secrets'
  | 'permissions'
  | 'hooks'
  | 'advanced';

// Common props for settings tabs
export interface SettingsTabProps {
  settings: SettingsType;
  onSettingsChange: (settings: SettingsType) => void;
}

// Workplace settings props (includes default paths)
export interface WorkplaceSettingsProps extends SettingsTabProps {
  defaultPaths: {
    workDir: string;
    mcpConfigPath: string;
    skillsPath: string;
  };
}

// Dependency status for workspace settings
export interface DependencyStatus {
  claudeCode: boolean;
  node: boolean;
  python: boolean;
  codex: boolean;
  srt: boolean;
}

// MCP Server Config Types
export interface MCPServerStdio {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPServerHttp {
  url: string;
  headers?: Record<string, string>;
  auth?: {
    type: 'oauth2.1' | 'none';
    pkce?: 'S256';
  };
  oauth?: {
    tokenStore?: 'encrypted';
    updatedAt?: string;
  };
}

export type MCPServerConfig = MCPServerStdio | MCPServerHttp;

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// Internal MCP server representation for UI
export interface MCPServerUI {
  id: string;
  name: string;
  type: 'stdio' | 'http' | 'sse';
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  auth?: {
    type: 'oauth2.1' | 'none';
    pkce?: 'S256';
  };
  oauth?: {
    tokenStore?: 'encrypted';
    updatedAt?: string;
  };
  autoExecute?: boolean;
  source?: 'app' | 'claude';
  /** True when the remote server requires an OAuth browser flow to authenticate */
  requiresOAuth?: boolean;
  /** Path to icon image relative to public root (e.g. "/mcp-icons/notion.svg") */
  icon?: string;
  advertisedToolCount?: number;
  authorizedToolCount?: number;
}

// Skill types
export interface SkillFile {
  name: string;
  path: string;
  isDir: boolean;
  children?: SkillFile[];
}

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
  source: 'claude' | 'app';
  path: string;
  files: SkillFile[];
  enabled: boolean;
  owner?: string;
  version?: string;
  publishedAt?: number;
  slug?: string;
  updateAvailable?: boolean;
  catalogVersion?: string;
}

export interface CatalogSkill {
  owner: string;
  slug: string;
  displayName: string;
  version: string;
  publishedAt: number;
  description?: string;
  installed?: boolean;
  builtIn?: boolean;
}

export interface CatalogResponse {
  success: boolean;
  items: CatalogSkill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Sub-tab types
export type ModelSubTab = 'settings' | string;
export type MCPSubTab = 'settings' | string;
export type SkillsSubTab = 'settings' | string;
