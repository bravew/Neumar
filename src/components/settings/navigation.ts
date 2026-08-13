import type { ComponentType } from 'react';

import {
  Brain,
  FolderOpen,
  Info,
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
