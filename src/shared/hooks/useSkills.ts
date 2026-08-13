/**
 * Hook to fetch and cache available skills from the backend.
 * Used by the ChatInput SkillSelector to show available skills for pinning.
 *
 * Only returns skills when the current agent type supports them (currently 'claude').
 */

import { useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

export interface SkillInfo {
  /** Skill name from SKILL.md frontmatter */
  name: string;
  /** Directory name (slug) */
  slug: string;
  /** Short description from frontmatter */
  description: string;
  /** Source directory: 'claude' (~/.claude/skills) or 'app' (workspace) */
  source: 'claude' | 'app';
  /** Slash command trigger (e.g., '/pdf') */
  trigger?: string;
  /** Category for grouping */
  category?: string;
  /** Lucide icon name */
  icon?: string;
}

// Module-level cache to avoid refetching on every mount
let cachedSkills: SkillInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

export function useSkills() {
  const [skills, setSkills] = useState<SkillInfo[]>(cachedSkills ?? []);
  const [loading, setLoading] = useState(cachedSkills === null);
  const [error, setError] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Return cached if fresh
    if (cachedSkills && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
      setSkills(cachedSkills);
      setLoading(false);
      return;
    }

    const ac = new AbortController();

    (async () => {
      try {
        setError(false);
        const res = await fetch(`${API_BASE_URL}/files/list-skills`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success || !mountedRef.current) return;

        const list: SkillInfo[] = data.skills ?? [];
        cachedSkills = list;
        cacheTimestamp = Date.now();

        if (mountedRef.current) {
          setSkills(list);
          setLoading(false);
        }
      } catch {
        if (mountedRef.current) {
          setError(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, [fetchKey]);

  /** Force refresh the cache and re-fetch immediately. */
  const refresh = () => {
    cachedSkills = null;
    cacheTimestamp = 0;
    setFetchKey((k) => k + 1);
  };

  return { skills, loading, error, refresh };
}

/** Invalidate the module-level cache from outside the hook. */
export function invalidateSkillsCache() {
  cachedSkills = null;
  cacheTimestamp = 0;
}
