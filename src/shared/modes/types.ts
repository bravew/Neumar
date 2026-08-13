import type { ComponentType } from 'react';

import type { TranslationKeys } from '@/config/locale';

export type ModeId = 'tasks' | 'design' | 'automate' | 'chat' | string;

export interface NavApi {
  navigate: (path: string) => void;
  openSettings: () => void;
  t: TranslationKeys;
}

export interface RecentsSourceProps {
  searchQuery: string;
  activeId?: string;
}

export interface ChipDefinition {
  id: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  action:
    | { kind: 'prefill'; prompt: string; promptKey?: string }
    | { kind: 'nav'; href: string };
}

export interface SidebarSection {
  id: string;
  labelKey: string;
  icon?: ComponentType<{ className?: string }>;
  href?: string;
  badge?: () => string | number | null;
}

export interface ModeDefinition {
  id: ModeId;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  rootPath: string;
  matches: (RegExp | string)[];
  shortcutSlot?: number;
  enabled: boolean;
  order: number;
  sidebar: {
    primaryAction: {
      labelKey: string;
      onSelect: (nav: NavApi) => void | Promise<void>;
    };
    sections: SidebarSection[];
    recentsSource?: ComponentType<RecentsSourceProps>;
    footer?: ComponentType;
  };
  composer?: {
    placeholderKey: string;
    starterChips?: ChipDefinition[];
  };
}
