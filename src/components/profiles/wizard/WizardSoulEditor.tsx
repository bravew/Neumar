/**
 * Compact soul editor with sub-tabs for the wizard Configure step.
 * Reuses the existing soul tab components from the edit mode.
 */

import { useCallback, useState } from 'react';

import {
  Brain,
  ChevronDown,
  ChevronUp,
  Fingerprint,
  MessageSquare,
  Shield,
  Sparkles,
} from 'lucide-react';

import type { ProfileFormData } from '@/components/profiles/ProfileDialog';
import { SoulBoundariesTab } from '@/components/profiles/soul/SoulBoundariesTab';
import { SoulCognitionTab } from '@/components/profiles/soul/SoulCognitionTab';
import { SoulIdentityTab } from '@/components/profiles/soul/SoulIdentityTab';
import { SoulVoiceTab } from '@/components/profiles/soul/SoulVoiceTab';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

const DEFAULT_SOUL: AgentSoul = {
  schema_version: '1.0',
  identity: { role: '', core_values: ['Helpful'] },
  voice: { tone: '', style_rules: ['Be clear and concise'] },
  cognition: { reasoning_style: '' },
  boundaries: { red_lines: ['Never fabricate information'] },
  evolution: { self_improving: false, max_corrections: 50, max_learnings: 100 },
};

const TAB_IDS = ['identity', 'voice', 'cognition', 'boundaries'] as const;
type SoulTabId = (typeof TAB_IDS)[number];

const TAB_ICONS: Record<SoulTabId, typeof Fingerprint> = {
  identity: Fingerprint,
  voice: MessageSquare,
  cognition: Brain,
  boundaries: Shield,
};

interface WizardSoulEditorProps {
  form: ProfileFormData;
  setForm: (updater: (prev: ProfileFormData) => ProfileFormData) => void;
}

export function WizardSoulEditor({ form, setForm }: WizardSoulEditorProps) {
  const { t } = useLanguage();
  const p = t.profiles;
  const [expanded, setExpanded] = useState(!!form.soul);
  const [activeTab, setActiveTab] = useState<SoulTabId>('identity');

  const soul: AgentSoul = form.soul ?? DEFAULT_SOUL;

  const handleSoulChange = useCallback(
    (newSoul: AgentSoul) => {
      setForm((prev) => ({ ...prev, soul: newSoul, soul_origin: 'user' }));
    },
    [setForm],
  );

  const tabLabels: Record<SoulTabId, string> = {
    identity: p.soulIdentity,
    voice: p.soulVoice,
    cognition: p.soulCognition,
    boundaries: p.soulBoundaries,
  };

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="hover:bg-accent/30 flex w-full items-center justify-between px-4 py-3 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="text-primary size-4" />
          <span className="text-sm font-semibold">{p.soulEditor}</span>
          {form.soul && (
            <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px] font-medium">
              v{form.soul_version}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="text-muted-foreground size-4" />
        ) : (
          <ChevronDown className="text-muted-foreground size-4" />
        )}
      </button>

      {expanded && (
        <div className="border-border border-t">
          {/* Sub-tabs */}
          <div className="border-border flex border-b">
            {TAB_IDS.map((id) => {
              const Icon = TAB_ICONS[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors',
                    'border-b-2',
                    activeTab === id
                      ? 'border-primary text-foreground'
                      : 'text-muted-foreground hover:text-foreground border-transparent',
                  )}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{tabLabels[id]}</span>
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="max-h-80 overflow-y-auto p-4">
            {activeTab === 'identity' && (
              <SoulIdentityTab soul={soul} onChange={handleSoulChange} />
            )}
            {activeTab === 'voice' && (
              <SoulVoiceTab soul={soul} onChange={handleSoulChange} />
            )}
            {activeTab === 'cognition' && (
              <SoulCognitionTab soul={soul} onChange={handleSoulChange} />
            )}
            {activeTab === 'boundaries' && (
              <SoulBoundariesTab soul={soul} onChange={handleSoulChange} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
