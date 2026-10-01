import type { ComponentType } from 'react';

import {
  Brain,
  CircleHelp,
  FolderOpen,
  HardDrive,
  Info,
  KeyRound,
  MessageSquare,
  Palette,
  Plug,
  Puzzle,
  Settings,
  Shield,
  Sparkles,
  User,
  WandSparkles,
} from 'lucide-react';

import type { SettingsCategory } from './types';

/**
 * Grouped settings navigation.
 *
 * The sidebar shows one entry per item; items with multiple categories render
 * those categories as sub-tabs under the page header. Category ids stay the
 * canonical `SettingsCategory` values so deep links (`initialCategory`) and
 * per-category content rendering keep working unchanged.
 */
export type SettingsNavItemId =
  | 'account'
  | 'general'
  | 'appearance'
  | 'models'
  | 'workspace'
  | 'capabilities'
  | 'extensions'
  | 'designMode'
  | 'connections'
  | 'privacy'
  | 'about';

export interface SettingsNavItem {
  id: SettingsNavItemId;
  /** Key into `t.settings` for the sidebar label */
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  /** Categories rendered as sub-tabs; the first is the default */
  categories: SettingsCategory[];
}

export interface SettingsNavGroup {
  id: string;
  /** Key into `t.settings` for the group header; omit for no header */
  labelKey?: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    id: 'top',
    items: [
      {
        id: 'account',
        labelKey: 'account',
        icon: User,
        categories: ['account', 'usage', 'data'],
      },
    ],
  },
  {
    id: 'app',
    labelKey: 'navGroupApp',
    items: [
      {
        id: 'general',
        labelKey: 'general',
        icon: Settings,
        categories: ['general', 'keyboard', 'advanced'],
      },
      {
        id: 'appearance',
        labelKey: 'appearance',
        icon: Palette,
        categories: ['theme', 'pets'],
      },
    ],
  },
  {
    id: 'agent',
    labelKey: 'navGroupAgent',
    items: [
      {
        id: 'models',
        labelKey: 'models',
        icon: Brain,
        categories: ['model', 'agentRuntimes'],
      },
      {
        id: 'workspace',
        labelKey: 'workplace',
        icon: FolderOpen,
        categories: ['workplace', 'profiles'],
      },
      {
        id: 'capabilities',
        labelKey: 'capabilities',
        icon: Sparkles,
        categories: ['memory', 'speech', 'search'],
      },
      {
        id: 'extensions',
        labelKey: 'extensions',
        icon: Puzzle,
        categories: ['mcp', 'skills', 'plugins', 'modes', 'hooks'],
      },
      {
        id: 'designMode',
        labelKey: 'designMode',
        icon: WandSparkles,
        categories: ['designMode'],
      },
    ],
  },
  {
    id: 'connections',
    labelKey: 'navGroupConnections',
    items: [
      {
        id: 'connections',
        labelKey: 'connector',
        icon: Plug,
        categories: ['connector', 'channels', 'publish'],
      },
    ],
  },
  {
    id: 'bottom',
    items: [
      {
        id: 'privacy',
        labelKey: 'privacy',
        icon: Shield,
        categories: ['permissions', 'secrets'],
      },
      {
        id: 'about',
        labelKey: 'about',
        icon: Info,
        categories: ['about'],
      },
    ],
  },
];

const ALL_ITEMS: SettingsNavItem[] = SETTINGS_NAV.flatMap(
  (group) => group.items,
);

/** Find the nav item that owns a category. Every category has exactly one owner. */
export function findNavItem(category: SettingsCategory): SettingsNavItem {
  return (
    ALL_ITEMS.find((item) => item.categories.includes(category)) ?? ALL_ITEMS[0]
  );
}

export const SETTINGS_PAGE_IDS = [
  'general',
  'models',
  'agents',
  'connectors',
  'channels',
  'permissions',
  'secrets',
  'memory',
  'data',
  'help',
] as const;

export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];

export interface SettingsLocation {
  page: SettingsPageId;
  drillIn?: string;
  searchKeys: string[];
}

export interface SettingsPageDefinition {
  id: SettingsPageId;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  homeCategory: SettingsCategory;
}

export const SETTINGS_PAGES: SettingsPageDefinition[] = [
  {
    id: 'general',
    labelKey: 'general',
    icon: Settings,
    homeCategory: 'account',
  },
  { id: 'models', labelKey: 'models', icon: Brain, homeCategory: 'model' },
  {
    id: 'agents',
    labelKey: 'pageAgents',
    icon: Puzzle,
    homeCategory: 'profiles',
  },
  {
    id: 'connectors',
    labelKey: 'connector',
    icon: Plug,
    homeCategory: 'connector',
  },
  {
    id: 'channels',
    labelKey: 'pageChannels',
    icon: MessageSquare,
    homeCategory: 'channels',
  },
  {
    id: 'permissions',
    labelKey: 'permissions',
    icon: Shield,
    homeCategory: 'permissions',
  },
  {
    id: 'secrets',
    labelKey: 'pageSecureStore',
    icon: KeyRound,
    homeCategory: 'secrets',
  },
  { id: 'memory', labelKey: 'memory', icon: Sparkles, homeCategory: 'memory' },
  {
    id: 'data',
    labelKey: 'pageData',
    icon: HardDrive,
    homeCategory: 'data',
  },
  { id: 'help', labelKey: 'pageHelp', icon: CircleHelp, homeCategory: 'about' },
];

export const CATEGORY_TO_LOCATION = {
  account: { page: 'general', searchKeys: ['account', 'profile'] },
  general: { page: 'general', searchKeys: ['general', 'language'] },
  theme: { page: 'general', searchKeys: ['theme', 'appearance'] },
  speech: {
    page: 'general',
    drillIn: 'voice',
    searchKeys: ['speech', 'voice'],
  },
  pets: { page: 'general', drillIn: 'advanced', searchKeys: ['pets'] },
  advanced: { page: 'general', drillIn: 'advanced', searchKeys: ['advanced'] },
  model: { page: 'models', searchKeys: ['model', 'models'] },
  agentRuntimes: {
    page: 'models',
    drillIn: 'advanced',
    searchKeys: ['agentRuntimes', 'runtime'],
  },
  profiles: { page: 'agents', searchKeys: ['profiles', 'agents'] },
  skills: { page: 'agents', searchKeys: ['skills'] },
  plugins: {
    page: 'agents',
    drillIn: 'advanced',
    searchKeys: ['plugins'],
  },
  mcp: { page: 'agents', drillIn: 'mcp', searchKeys: ['mcp'] },
  modes: { page: 'agents', drillIn: 'advanced', searchKeys: ['modes'] },
  hooks: { page: 'agents', drillIn: 'advanced', searchKeys: ['hooks'] },
  search: { page: 'agents', drillIn: 'advanced', searchKeys: ['search'] },
  designMode: {
    page: 'agents',
    drillIn: 'advanced',
    searchKeys: ['designMode'],
  },
  connector: { page: 'connectors', searchKeys: ['connector', 'connectors'] },
  publish: { page: 'connectors', searchKeys: ['publish'] },
  channels: { page: 'channels', searchKeys: ['channels'] },
  permissions: { page: 'permissions', searchKeys: ['permissions'] },
  secrets: { page: 'secrets', searchKeys: ['secrets'] },
  memory: { page: 'memory', searchKeys: ['memory'] },
  data: { page: 'data', searchKeys: ['data', 'privacy'] },
  usage: { page: 'data', drillIn: 'usage', searchKeys: ['usage'] },
  workplace: { page: 'data', searchKeys: ['workplace', 'workDir'] },
  about: { page: 'help', searchKeys: ['about'] },
  keyboard: {
    page: 'help',
    drillIn: 'shortcuts',
    searchKeys: ['keyboard', 'shortcuts'],
  },
} satisfies Record<SettingsCategory, SettingsLocation>;

export function settingsPage(id: SettingsPageId): SettingsPageDefinition {
  const page = SETTINGS_PAGES.find((entry) => entry.id === id);
  if (!page) throw new Error(`Unknown settings page: ${id}`);
  return page;
}

export function resolveSettingsLocation(
  category: SettingsCategory,
): SettingsLocation {
  return CATEGORY_TO_LOCATION[category];
}
