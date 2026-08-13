import { useCallback, useMemo } from 'react';

import * as Tabs from '@radix-ui/react-tabs';
import {
  Brain,
  FileText,
  Fingerprint,
  MessageSquare,
  Settings2,
  Shield,
  Sparkles,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import type { ProfileFormData } from '../ProfileDialog';
import { SoulBoundariesTab } from '../soul/SoulBoundariesTab';
import { SoulCognitionTab } from '../soul/SoulCognitionTab';
import type { CorrectionEntry, LearningEntry } from '../soul/SoulEvolutionTab';
import { SoulEvolutionTab } from '../soul/SoulEvolutionTab';
import { SoulIdentityTab } from '../soul/SoulIdentityTab';
import { SoulVoiceTab } from '../soul/SoulVoiceTab';
import { OverviewTabContent } from './OverviewTabContent';
import { ToolsTabContent } from './ToolsTabContent';

/** Stable default soul — extracted to module scope to preserve referential equality. */
const DEFAULT_SOUL: AgentSoul = {
  schema_version: '1.0',
  identity: { role: '', core_values: ['Helpful'] },
  voice: { tone: '', style_rules: ['Be clear and concise'] },
  cognition: { reasoning_style: '' },
  boundaries: { red_lines: ['Never fabricate information'] },
  evolution: { self_improving: false, max_corrections: 50, max_learnings: 100 },
};

// ============================================================================
// Tab definition
// ============================================================================

const TAB_IDS = [
  'overview',
  'identity',
  'voice',
  'cognition',
  'boundaries',
  'tools',
  'evolution',
] as const;

type TabId = (typeof TAB_IDS)[number];

const TAB_ICONS: Record<TabId, typeof FileText> = {
  overview: FileText,
  identity: Fingerprint,
  voice: MessageSquare,
  cognition: Brain,
  boundaries: Shield,
  tools: Settings2,
  evolution: Sparkles,
};

// ============================================================================
// Component
// ============================================================================

interface ProfileDetailTabsProps {
  form: ProfileFormData;
  setForm: React.Dispatch<React.SetStateAction<ProfileFormData>>;
  profileId: string;
  corrections: CorrectionEntry[];
  learnings: LearningEntry[];
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function ProfileDetailTabs({
  form,
  setForm,
  profileId,
  corrections,
  learnings,
  activeTab,
  onTabChange,
}: ProfileDetailTabsProps) {
  const { t } = useLanguage();

  const tabLabels = useMemo<Record<TabId, string>>(
    () => ({
      overview: t.profiles.tabOverview,
      identity: t.profiles.soulIdentity,
      voice: t.profiles.soulVoice,
      cognition: t.profiles.soulCognition,
      boundaries: t.profiles.soulBoundaries,
      tools: t.profiles.tabTools,
      evolution: t.profiles.soulEvolution,
    }),
    [t.profiles],
  );

  const soul: AgentSoul = form.soul ?? DEFAULT_SOUL;

  const handleSoulChange = useCallback(
    (newSoul: AgentSoul) => {
      setForm((prev) => ({ ...prev, soul: newSoul, soul_origin: 'user' }));
    },
    [setForm],
  );

  const handleRoleChange = useCallback(
    (role: string, autoPrompt?: string) => {
      setForm((prev) => {
        const updates: Partial<ProfileFormData> = { role };
        if (autoPrompt && !prev.system_prompt && !prev.soul) {
          updates.system_prompt = autoPrompt;
        }
        return { ...prev, ...updates };
      });
    },
    [setForm],
  );

  const toggleMcp = useCallback(
    (id: string) => {
      setForm((prev) => ({
        ...prev,
        default_mcp_servers: prev.default_mcp_servers.includes(id)
          ? prev.default_mcp_servers.filter((s) => s !== id)
          : [...prev.default_mcp_servers, id],
      }));
    },
    [setForm],
  );

  const toggleSkill = useCallback(
    (id: string) => {
      setForm((prev) => {
        const current = prev.default_skills ?? [];
        return {
          ...prev,
          default_skills: current.includes(id)
            ? current.filter((s) => s !== id)
            : [...current, id],
        };
      });
    },
    [setForm],
  );

  const setAllowAllSkills = useCallback(
    (allowAll: boolean) => {
      setForm((prev) => ({
        ...prev,
        default_skills: allowAll ? null : [],
      }));
    },
    [setForm],
  );

  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(v) => onTabChange(v as TabId)}
      className="flex h-full flex-col"
    >
      <Tabs.List className="border-border flex shrink-0 overflow-x-auto border-b">
        {TAB_IDS.map((id) => {
          const Icon = TAB_ICONS[id];
          return (
            <Tabs.Trigger
              key={id}
              value={id}
              className={cn(
                'flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors',
                'text-muted-foreground hover:text-foreground',
                'border-b-2 border-transparent',
                'data-[state=active]:border-primary data-[state=active]:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {tabLabels[id]}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
        <Tabs.Content value="overview" className="min-h-0 flex-1 outline-none">
          <OverviewTabContent
            role={form.role}
            description={form.description}
            systemPrompt={form.system_prompt}
            hasSoul={form.soul !== null}
            profileId={profileId}
            onRoleChange={handleRoleChange}
            onDescriptionChange={(d) =>
              setForm((prev) => ({ ...prev, description: d }))
            }
            onSystemPromptChange={(p) =>
              setForm((prev) => ({ ...prev, system_prompt: p }))
            }
          />
        </Tabs.Content>

        <Tabs.Content value="identity" className="outline-none">
          <SoulIdentityTab soul={soul} onChange={handleSoulChange} />
        </Tabs.Content>

        <Tabs.Content value="voice" className="outline-none">
          <SoulVoiceTab soul={soul} onChange={handleSoulChange} />
        </Tabs.Content>

        <Tabs.Content value="cognition" className="outline-none">
          <SoulCognitionTab soul={soul} onChange={handleSoulChange} />
        </Tabs.Content>

        <Tabs.Content value="boundaries" className="outline-none">
          <SoulBoundariesTab soul={soul} onChange={handleSoulChange} />
        </Tabs.Content>

        <Tabs.Content
          value="tools"
          className="flex min-h-0 flex-1 flex-col outline-none"
        >
          <ToolsTabContent
            selectedMcp={form.default_mcp_servers}
            selectedSkills={form.default_skills}
            maxConcurrentTasks={form.max_concurrent_tasks}
            onToggleMcp={toggleMcp}
            onToggleSkill={toggleSkill}
            onAllowAllSkillsChange={setAllowAllSkills}
            onMaxTasksChange={(n) =>
              setForm((prev) => ({ ...prev, max_concurrent_tasks: n }))
            }
          />
        </Tabs.Content>

        <Tabs.Content value="evolution" className="outline-none">
          <SoulEvolutionTab
            soul={soul}
            onChange={handleSoulChange}
            corrections={corrections}
            learnings={learnings}
          />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}

export type { TabId };
