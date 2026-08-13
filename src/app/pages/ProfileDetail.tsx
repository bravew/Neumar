import { useCallback, useEffect, useRef, useState } from 'react';

import { useNavigate, useParams } from 'react-router-dom';

import { ArrowLeft, Loader2 } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { ProfileDetailSidebar } from '@/components/profiles/detail/ProfileDetailSidebar';
import { ProfileDetailTabs } from '@/components/profiles/detail/ProfileDetailTabs';
import type { TabId } from '@/components/profiles/detail/ProfileDetailTabs';
import { ProfileSaveBar } from '@/components/profiles/detail/ProfileSaveBar';
import type { ProviderInfo } from '@/components/profiles/profile-constants';
import type { ProfileFormData } from '@/components/profiles/ProfileDialog';
import type {
  CorrectionEntry,
  LearningEntry,
} from '@/components/profiles/soul/SoulEvolutionTab';
import { ProfileWizard } from '@/components/profiles/wizard/ProfileWizard';
import { API_BASE_URL } from '@/config';
import { motion, SPRING } from '@/config/animation';
import { invalidateProfilesCache } from '@/shared/hooks/useAgentProfiles';
import { parseJsonArray } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentProfile } from '@/shared/types/agent-profile';
import { randomUUID } from '@/shared/utils/uuid';

// ============================================================================
// Constants
// ============================================================================

function parseRoutingHints(
  raw: string | null,
): ProfileFormData['routing_hints'] {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const channels = Array.isArray(parsed.channels) ? parsed.channels : [];
    const intents = Array.isArray(parsed.intents) ? parsed.intents : [];
    const chatPatterns = Array.isArray(parsed.chatPatterns)
      ? parsed.chatPatterns
      : [];
    if (!channels.length && !intents.length && !chatPatterns.length) {
      return null;
    }
    return { channels, intents, chatPatterns };
  } catch {
    return null;
  }
}

function serializeRoutingHints(
  hints: ProfileFormData['routing_hints'],
): string | null {
  if (!hints) return null;
  const channels = hints.channels?.filter(Boolean) ?? [];
  const intents = hints.intents?.filter(Boolean) ?? [];
  const chatPatterns = hints.chatPatterns?.filter(Boolean) ?? [];
  if (!channels.length && !intents.length && !chatPatterns.length) {
    return null;
  }
  return JSON.stringify({ channels, intents, chatPatterns });
}

const INITIAL_FORM: ProfileFormData = {
  name: '',
  role: '',
  description: '',
  avatar_color: '#6366f1',
  avatar_icon: 'sparkles',
  runtime_id: '',
  default_model: '',
  system_prompt: '',
  soul: null,
  soul_version: 0,
  soul_origin: 'user',
  status: 'active',
  default_mcp_servers: [],
  default_skills: null,
  max_concurrent_tasks: 1,
  thinking_config: null,
  routing_hints: null,
};

// ============================================================================
// Page wrapper
// ============================================================================

export function ProfileDetailPage() {
  return (
    <SidebarProvider>
      <ProfileDetailContent />
    </SidebarProvider>
  );
}

// ============================================================================
// Content
// ============================================================================

function ProfileDetailContent() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const isNew = routeId === 'new';
  // For new profiles, generate a stable ID on mount
  const newIdRef = useRef<string>(randomUUID());
  const profileId = isNew ? newIdRef.current : routeId;

  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState<ProfileFormData | null>(
    isNew ? { ...INITIAL_FORM } : null,
  );
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [corrections, setCorrections] = useState<CorrectionEntry[]>([]);
  const [learnings, setLearnings] = useState<LearningEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // Snapshot of last-saved state for dirty detection
  const savedFormRef = useRef<string>(
    isNew ? JSON.stringify(INITIAL_FORM) : '',
  );

  // ── Data fetching ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!profileId) return;
    const ac = new AbortController();

    (async () => {
      try {
        if (!isNew) {
          // Fetch everything in parallel
          const [providersRes, profileRes, correctionsRes, learningsRes] =
            await Promise.all([
              fetch(`${API_BASE_URL}/providers/agents`, { signal: ac.signal }),
              fetch(`${API_BASE_URL}/db/agent-profiles/${profileId}`, {
                signal: ac.signal,
              }),
              fetch(
                `${API_BASE_URL}/soul/agent-profiles/${profileId}/corrections`,
                { signal: ac.signal },
              ),
              fetch(
                `${API_BASE_URL}/soul/agent-profiles/${profileId}/learnings`,
                { signal: ac.signal },
              ),
            ]);

          if (providersRes.ok) {
            const data = (await providersRes.json()) as {
              providers: ProviderInfo[];
            };
            setProviders(data.providers ?? []);
          }

          if (!profileRes.ok) {
            setNotFound(true);
            setLoading(false);
            return;
          }

          const profile: AgentProfile = await profileRes.json();
          let parsedSoul = null;
          try {
            parsedSoul = profile.soul ? JSON.parse(profile.soul) : null;
          } catch {
            // invalid JSON
          }

          let parsedThinking = null;
          try {
            parsedThinking = profile.default_thinking_config
              ? JSON.parse(profile.default_thinking_config)
              : null;
          } catch {
            // invalid JSON
          }

          const formData: ProfileFormData = {
            name: profile.name,
            role: profile.role ?? '',
            description: profile.description ?? '',
            avatar_color: profile.avatar_color ?? '#6366f1',
            avatar_icon: profile.avatar_icon ?? 'sparkles',
            runtime_id: profile.runtime_id ?? '',
            default_model: profile.default_model ?? '',
            system_prompt: profile.system_prompt ?? '',
            soul: parsedSoul,
            soul_version: profile.soul_version ?? 0,
            soul_origin: profile.soul_origin ?? 'user',
            status: profile.status,
            default_mcp_servers: parseJsonArray(profile.default_mcp_servers),
            default_skills: profile.default_skills
              ? parseJsonArray(profile.default_skills)
              : null,
            max_concurrent_tasks: profile.max_concurrent_tasks,
            thinking_config: parsedThinking,
            routing_hints: parseRoutingHints(profile.routing_hints),
          };

          setForm(formData);
          savedFormRef.current = JSON.stringify(formData);

          if (correctionsRes.ok) {
            setCorrections(await correctionsRes.json());
          }
          if (learningsRes.ok) {
            setLearnings(await learningsRes.json());
          }
        } else {
          // New profile — only need providers
          const providersRes = await fetch(`${API_BASE_URL}/providers/agents`, {
            signal: ac.signal,
          });
          if (providersRes.ok) {
            const data = (await providersRes.json()) as {
              providers: ProviderInfo[];
            };
            setProviders(data.providers ?? []);
          }
        }
      } catch {
        // abort or network error
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [profileId, isNew]);

  // ── Save ───────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!form || !profileId || !form.name.trim() || !form.runtime_id.trim())
      return;
    setSaving(true);
    try {
      const { thinking_config, routing_hints, ...rest } = form;
      const payload = {
        ...rest,
        soul: form.soul ? JSON.stringify(form.soul) : undefined,
        default_mcp_servers: JSON.stringify(form.default_mcp_servers),
        default_skills:
          form.default_skills !== null
            ? JSON.stringify(form.default_skills)
            : null,
        default_thinking_config: thinking_config
          ? JSON.stringify(thinking_config)
          : null,
        routing_hints: serializeRoutingHints(routing_hints),
      };

      if (isNew) {
        const res = await fetch(`${API_BASE_URL}/db/agent-profiles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, id: profileId }),
        });
        if (res.ok) {
          invalidateProfilesCache();
          navigate(`/org/${profileId}`, { replace: true });
        }
      } else {
        const res = await fetch(
          `${API_BASE_URL}/db/agent-profiles/${profileId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        if (res.ok) {
          savedFormRef.current = JSON.stringify(form);
          invalidateProfilesCache();
        }
      }
    } catch {
      // Network error
    } finally {
      setSaving(false);
    }
  }, [form, profileId, isNew, navigate]);

  const handleDiscard = useCallback(() => {
    if (isNew) {
      navigate('/org');
    } else if (savedFormRef.current) {
      try {
        setForm(JSON.parse(savedFormRef.current) as ProfileFormData);
      } catch {
        // Corrupted snapshot — reload page
        navigate(0 as unknown as string);
      }
    }
  }, [isNew, navigate]);

  // No useMemo — must recompute every render so it picks up savedFormRef changes after save
  const isDirty = form ? JSON.stringify(form) !== savedFormRef.current : false;

  // Narrow setForm for child components (render path guards form !== null)
  const setFormNonNull = setForm as React.Dispatch<
    React.SetStateAction<ProfileFormData>
  >;

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-sidebar flex h-screen overflow-hidden">
        <LeftSidebar tasks={[]} />
        <main className="bg-background my-2 mr-2 flex flex-1 items-center justify-center rounded-l-2xl shadow-sm">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </main>
      </div>
    );
  }

  // ── Multi-step wizard (new agent) ────────────────────────────────────────

  if (isNew && form) {
    return (
      <div className="bg-sidebar flex h-screen overflow-hidden">
        <LeftSidebar tasks={[]} />
        <main className="bg-background my-2 mr-2 flex flex-1 flex-col overflow-hidden rounded-l-2xl shadow-sm">
          <ProfileWizard profileId={profileId!} initialForm={form} />
        </main>
      </div>
    );
  }

  if (notFound || !form || !profileId) {
    return (
      <div className="bg-sidebar flex h-screen overflow-hidden">
        <LeftSidebar tasks={[]} />
        <main className="bg-background my-2 mr-2 flex flex-1 flex-col items-center justify-center gap-3 rounded-l-2xl shadow-sm">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-muted-foreground text-sm"
          >
            {t.profiles.profileNotFound}
          </motion.p>
          <button
            onClick={() => navigate('/org')}
            className="text-primary text-sm hover:underline"
          >
            {t.profiles.backToProfiles}
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      <LeftSidebar tasks={[]} />

      <motion.main
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ ...SPRING.gentle }}
        className="bg-background my-2 mr-2 flex flex-1 flex-col overflow-hidden rounded-l-2xl shadow-sm"
      >
        {/* Header */}
        <div className="border-border flex shrink-0 items-center gap-3 border-b px-5 py-3">
          <button
            onClick={() => navigate('/org')}
            className="text-muted-foreground hover:text-foreground rounded-lg p-1 transition-colors"
            aria-label={t.profiles.backToProfiles}
          >
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="text-foreground text-base font-semibold">
            {form.name ||
              (isNew ? t.profiles.createProfile : t.profiles.profileDetail)}
          </h1>
          {!isNew && (
            <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
              {t.profiles[form.status as keyof typeof t.profiles] ??
                form.status}
            </span>
          )}
        </div>

        {/* Two-column layout */}
        <div className="flex min-h-0 flex-1">
          <ProfileDetailSidebar
            form={form}
            setForm={setFormNonNull}
            providers={providers}
            profileId={profileId}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <ProfileDetailTabs
              form={form}
              setForm={setFormNonNull}
              profileId={profileId}
              corrections={corrections}
              learnings={learnings}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          </div>
        </div>

        {/* Save bar */}
        <ProfileSaveBar
          dirty={isDirty}
          saving={saving}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      </motion.main>
    </div>
  );
}
