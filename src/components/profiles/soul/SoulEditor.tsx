import { useEffect, useMemo, useRef, useState } from 'react';

import * as Tabs from '@radix-ui/react-tabs';
import {
  Brain,
  Fingerprint,
  MessageSquare,
  Shield,
  Sparkles,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import { SoulBoundariesTab } from './SoulBoundariesTab';
import { SoulCognitionTab } from './SoulCognitionTab';
import type { CorrectionEntry, LearningEntry } from './SoulEvolutionTab';
import { SoulEvolutionTab } from './SoulEvolutionTab';
import { SoulIdentityTab } from './SoulIdentityTab';
import { SoulVoiceTab } from './SoulVoiceTab';

// ============================================================================
// Default soul factory
// ============================================================================

function createDefaultSoul(defaults: {
  value: string;
  styleRule: string;
  redLine: string;
}): AgentSoul {
  return {
    schema_version: '1.0',
    identity: {
      role: '',
      core_values: [defaults.value],
    },
    voice: {
      tone: '',
      style_rules: [defaults.styleRule],
    },
    cognition: {
      reasoning_style: '',
    },
    boundaries: {
      red_lines: [defaults.redLine],
    },
    evolution: {
      self_improving: false,
      max_corrections: 50,
      max_learnings: 50,
    },
  };
}

// ============================================================================
// Tab definition
// ============================================================================

const SOUL_TABS = [
  { id: 'identity', icon: Fingerprint },
  { id: 'voice', icon: MessageSquare },
  { id: 'cognition', icon: Brain },
  { id: 'boundaries', icon: Shield },
  { id: 'evolution', icon: Sparkles },
] as const;

type TabId = (typeof SOUL_TABS)[number]['id'];

// ============================================================================
// SoulEditor
// ============================================================================

export interface SoulEditorProps {
  soul: AgentSoul | null;
  onChange: (soul: AgentSoul) => void;
  corrections?: CorrectionEntry[];
  learnings?: LearningEntry[];
}

export function SoulEditor({
  soul: soulProp,
  onChange,
  corrections = [],
  learnings = [],
}: SoulEditorProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabId>('identity');
  const didPushDefault = useRef(false);

  const soulDefaults = useMemo(
    () => ({
      value: t.profiles.soulDefaultValue,
      styleRule: t.profiles.soulDefaultStyleRule,
      redLine: t.profiles.soulDefaultRedLine,
    }),
    [t],
  );
  const soul = useMemo(
    () => soulProp ?? createDefaultSoul(soulDefaults),
    [soulProp, soulDefaults],
  );

  const tabLabels = useMemo<Record<TabId, string>>(
    () => ({
      identity: t.profiles.soulIdentity,
      voice: t.profiles.soulVoice,
      cognition: t.profiles.soulCognition,
      boundaries: t.profiles.soulBoundaries,
      evolution: t.profiles.soulEvolution,
    }),
    [t],
  );

  // Push the default soul up once on mount if prop was null
  useEffect(() => {
    if (!soulProp && !didPushDefault.current) {
      didPushDefault.current = true;
      onChange(soul);
    }
  }, [soulProp, soul, onChange]);

  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as TabId)}
      className="flex h-full flex-col"
    >
      {/* Tab List */}
      <Tabs.List className="border-border flex shrink-0 border-b">
        {SOUL_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <Tabs.Trigger
              key={tab.id}
              value={tab.id}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
                'text-muted-foreground hover:text-foreground',
                'border-b-2 border-transparent',
                'data-[state=active]:border-primary data-[state=active]:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {tabLabels[tab.id]}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto pt-4">
        <Tabs.Content value="identity" className="outline-none">
          <SoulIdentityTab soul={soul} onChange={onChange} />
        </Tabs.Content>

        <Tabs.Content value="voice" className="outline-none">
          <SoulVoiceTab soul={soul} onChange={onChange} />
        </Tabs.Content>

        <Tabs.Content value="cognition" className="outline-none">
          <SoulCognitionTab soul={soul} onChange={onChange} />
        </Tabs.Content>

        <Tabs.Content value="boundaries" className="outline-none">
          <SoulBoundariesTab soul={soul} onChange={onChange} />
        </Tabs.Content>

        <Tabs.Content value="evolution" className="outline-none">
          <SoulEvolutionTab
            soul={soul}
            onChange={onChange}
            corrections={corrections}
            learnings={learnings}
          />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
