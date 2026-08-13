import { useCallback, useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Building2, Plus } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { OrgProfileCard } from '@/components/org/OrgProfileCard';
import { API_BASE_URL } from '@/config';
import {
  AnimatePresence,
  DURATION,
  EASE,
  listItem,
  motion,
  SCALE,
  staggerContainerSlow,
} from '@/config/animation';
import { invalidateProfilesCache } from '@/shared/hooks/useAgentProfiles';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentProfile } from '@/shared/types/agent-profile';

// ============================================================================
// Constants
// ============================================================================

const POLL_INTERVAL_MS = 15_000;

type StatusFilter = 'all' | 'active' | 'paused' | 'archived';

// ============================================================================
// Page wrapper (provides sidebar context)
// ============================================================================

export function OrgViewPage() {
  return (
    <SidebarProvider>
      <OrgViewContent />
    </SidebarProvider>
  );
}

// ============================================================================
// Content
// ============================================================================

function OrgViewContent() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchProfiles = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE_URL}/db/agent-profiles`, { signal });
      if (!res.ok) return;
      const data: AgentProfile[] = await res.json();
      setProfiles(data);
    } catch {
      // ignore abort / network errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchProfiles(ac.signal);
    const id = setInterval(() => fetchProfiles(ac.signal), POLL_INTERVAL_MS);
    return () => {
      ac.abort();
      clearInterval(id);
    };
  }, [fetchProfiles]);

  // ── CRUD actions ─────────────────────────────────────────────────────────

  const handleStatusChange = async (
    profile: AgentProfile,
    status: 'active' | 'paused' | 'archived',
  ) => {
    await fetch(`${API_BASE_URL}/db/agent-profiles/${profile.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    invalidateProfilesCache();
    fetchProfiles();
  };

  const handleConfirmDelete = async (id: string) => {
    const res = await fetch(`${API_BASE_URL}/db/agent-profiles/${id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setDeleteConfirmId(null);
      invalidateProfilesCache();
      fetchProfiles();
    }
  };

  const handleNewTask = (profile: AgentProfile) => {
    navigate('/', { state: { preSelectProfileId: profile.id } });
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const filtered =
    filter === 'all' ? profiles : profiles.filter((p) => p.status === filter);

  const countFor = (s: StatusFilter) =>
    s === 'all'
      ? profiles.length
      : profiles.filter((p) => p.status === s).length;

  const TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t.profiles.all },
    { key: 'active', label: t.profiles.active },
    { key: 'paused', label: t.profiles.paused },
    { key: 'archived', label: t.profiles.archived },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="bg-sidebar flex h-screen overflow-hidden"
      data-testid="org-page"
    >
      <LeftSidebar tasks={[]} />

      <main className="bg-background my-2 mr-2 flex flex-1 flex-col overflow-hidden rounded-l-2xl shadow-sm">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.moderate, ease: EASE.out }}
          className="border-border flex shrink-0 items-center justify-between border-b px-6 py-4"
        >
          <div className="flex items-center gap-3">
            <Building2 className="text-primary size-5" />
            <h1 className="text-foreground text-lg font-semibold">
              {t.nav.orgView}
            </h1>
            <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
              {t.profiles.advanced ?? 'Advanced'}
            </span>
          </div>
          <motion.button
            whileTap={{ scale: SCALE.tap }}
            onClick={() => navigate('/org/new')}
            className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" />
            {t.profiles.newAgent}
          </motion.button>
        </motion.div>

        {/* Status filter tabs */}
        <div className="border-border flex shrink-0 gap-1 border-b px-6">
          {TABS.map((tab) => {
            const count = countFor(tab.key);
            const isActive = filter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={cn(
                  'relative flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'border-primary text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-xs',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Grid content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-muted-foreground py-24 text-center text-sm">
              {t.common.loading}
            </div>
          ) : filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: DURATION.moderate, ease: EASE.out }}
              className="flex flex-col items-center justify-center gap-3 py-24"
            >
              <Building2 className="text-muted-foreground/30 size-12" />
              <p className="text-muted-foreground text-sm">
                {profiles.length === 0
                  ? t.profiles.noProfiles
                  : t.profiles.noProfilesForFilter}
              </p>
              {profiles.length === 0 && (
                <motion.button
                  whileTap={{ scale: SCALE.tap }}
                  onClick={() => navigate('/org/new')}
                  className="bg-primary text-primary-foreground mt-1 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                >
                  <Plus className="size-4" />
                  {t.profiles.newAgent}
                </motion.button>
              )}
            </motion.div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={filter}
                variants={staggerContainerSlow}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              >
                {filtered.map((profile) => (
                  <motion.div key={profile.id} variants={listItem} layout>
                    <OrgProfileCard
                      profile={profile}
                      onNewTask={() => handleNewTask(profile)}
                      onEdit={() => navigate(`/org/${profile.id}`)}
                      onDelete={() => setDeleteConfirmId(profile.id)}
                      onStatusChange={handleStatusChange}
                      deleteConfirmId={deleteConfirmId}
                      onConfirmDelete={handleConfirmDelete}
                      onCancelDelete={() => setDeleteConfirmId(null)}
                      t={t}
                    />
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </main>
    </div>
  );
}
