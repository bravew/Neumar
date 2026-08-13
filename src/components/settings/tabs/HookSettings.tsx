import { useCallback, useEffect, useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { API_BASE_URL } from '../constants';
import type { SettingsTabProps } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

type HookEvent = 'PreToolUse' | 'PostToolUse';
type HookType = 'command' | 'http' | 'prompt' | 'agent';

interface HookEntry {
  event: HookEvent;
  matcher?: string;
  type: HookType;
  command?: string;
  url?: string;
  timeout?: number;
}

interface HooksConfig {
  [event: string]: Array<{
    matcher?: string;
    hooks: Array<{
      type: HookType;
      command?: string;
      url?: string;
      timeout?: number;
    }>;
  }>;
}

const HOOK_EVENTS: HookEvent[] = ['PreToolUse', 'PostToolUse'];
const HOOK_TYPES: HookType[] = ['command', 'http', 'prompt', 'agent'];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Flatten nested Claude Code hooks JSON format into a flat list for display. */
function flattenHooks(config: HooksConfig): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const event of Object.keys(config)) {
    const matchers = config[event];
    if (!Array.isArray(matchers)) continue;
    for (const matcherGroup of matchers) {
      if (!Array.isArray(matcherGroup.hooks)) continue;
      for (const hook of matcherGroup.hooks) {
        entries.push({
          event: event as HookEvent,
          matcher: matcherGroup.matcher,
          type: hook.type,
          command: hook.command,
          url: hook.url,
          timeout: hook.timeout,
        });
      }
    }
  }
  return entries;
}

/** Convert flat entries back to nested Claude Code hooks JSON format. */
function unflattenHooks(entries: HookEntry[]): HooksConfig {
  const config: HooksConfig = {};
  for (const entry of entries) {
    if (!config[entry.event]) config[entry.event] = [];
    // Find or create matcher group
    const matchers = config[entry.event];
    let group = matchers.find((m) => m.matcher === entry.matcher);
    if (!group) {
      group = { matcher: entry.matcher, hooks: [] };
      matchers.push(group);
    }
    group.hooks.push({
      type: entry.type,
      command: entry.command,
      url: entry.url,
      timeout: entry.timeout,
    });
  }
  return config;
}

// ── Main Component ───────────────────────────────────────────────────────────

export function HookSettings({
  settings: _settings,
  onSettingsChange: _onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const [hooks, setHooks] = useState<HookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  // New hook form state
  const [newHook, setNewHook] = useState<HookEntry>({
    event: 'PreToolUse',
    matcher: '',
    type: 'command',
    command: '',
  });

  // Load hooks from backend
  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE_URL}/db/settings/hooks`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.value) {
          try {
            const parsed = JSON.parse(data.value);
            setHooks(flattenHooks(parsed));
          } catch {
            // Invalid JSON
          }
        }
      })
      .catch(() => {
        // Network error
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  const s = t.settings as Record<string, string>;

  // Save hooks to backend (optimistic update with rollback)
  const saveHooks = useCallback(
    (entries: HookEntry[], toastMsg?: string) => {
      const prev = hooks;
      setHooks(entries);
      const config = unflattenHooks(entries);
      fetch(`${API_BASE_URL}/db/settings/hooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(config) }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (toastMsg) toast.success(toastMsg);
        })
        .catch(() => {
          setHooks(prev);
          toast.error(s.toastHookSaveFailed ?? 'Failed to save hook');
        });
    },
    [hooks, s],
  );

  const addHook = useCallback(() => {
    const entry = { ...newHook };
    if (entry.type === 'http') {
      entry.command = undefined;
    } else {
      entry.url = undefined;
    }
    saveHooks([...hooks, entry], s.toastHookSaved ?? 'Hook saved');
    setNewHook({
      event: 'PreToolUse',
      matcher: '',
      type: 'command',
      command: '',
    });
    setShowAddForm(false);
  }, [newHook, hooks, saveHooks, s]);

  const removeHook = useCallback(
    (index: number) => {
      saveHooks(
        hooks.filter((_, i) => i !== index),
        s.toastHookDeleted ?? 'Hook removed',
      );
    },
    [hooks, saveHooks, s],
  );

  if (loading) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        {t.settings.hooksDescription}
      </p>

      {/* Hooks list */}
      {hooks.length > 0 ? (
        <div className="space-y-2">
          {hooks.map((hook, i) => (
            <div
              key={i}
              className="bg-muted/50 group flex items-start justify-between rounded-lg p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-medium">
                    {hook.event}
                  </span>
                  <span className="bg-muted rounded px-1.5 py-0.5 text-xs">
                    {hook.type}
                  </span>
                  {hook.matcher && (
                    <code className="text-muted-foreground text-xs">
                      {hook.matcher}
                    </code>
                  )}
                </div>
                <p className="truncate font-mono text-xs">
                  {hook.command || hook.url || '—'}
                </p>
                {hook.timeout && (
                  <p className="text-muted-foreground text-xs">
                    {t.settings.hookTimeout}: {hook.timeout}ms
                  </p>
                )}
              </div>
              <button
                onClick={() => removeHook(i)}
                className="text-muted-foreground hover:text-destructive ml-2 cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
                title={t.settings.removeRule}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground py-4 text-center text-sm">
          {t.settings.noHooks}
        </div>
      )}

      {/* Add hook form */}
      {showAddForm ? (
        <div className="border-border space-y-3 rounded-lg border p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-muted-foreground mb-1 block text-xs">
                {t.settings.hookEvent}
              </label>
              <select
                value={newHook.event}
                onChange={(e) =>
                  setNewHook({ ...newHook, event: e.target.value as HookEvent })
                }
                className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-xs"
              >
                {HOOK_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-xs">
                {t.settings.hookType}
              </label>
              <select
                value={newHook.type}
                onChange={(e) =>
                  setNewHook({ ...newHook, type: e.target.value as HookType })
                }
                className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-xs"
              >
                {HOOK_TYPES.map((ht) => (
                  <option key={ht} value={ht}>
                    {ht}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-xs">
              {t.settings.hookMatcher}
            </label>
            <input
              type="text"
              value={newHook.matcher ?? ''}
              onChange={(e) =>
                setNewHook({ ...newHook, matcher: e.target.value })
              }
              placeholder="Bash|Write|Edit"
              className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-xs">
              {newHook.type === 'http'
                ? t.settings.hookUrl
                : t.settings.hookCommand}
            </label>
            <input
              type="text"
              value={
                newHook.type === 'http'
                  ? (newHook.url ?? '')
                  : (newHook.command ?? '')
              }
              onChange={(e) =>
                setNewHook(
                  newHook.type === 'http'
                    ? { ...newHook, url: e.target.value }
                    : { ...newHook, command: e.target.value },
                )
              }
              placeholder={
                newHook.type === 'http'
                  ? 'https://example.com/hook'
                  : 'echo "hook triggered"'
              }
              className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAddForm(false)}
              className="hover:bg-muted cursor-pointer rounded-md px-3 py-1.5 text-xs"
            >
              {t.settings.cancel}
            </button>
            <button
              onClick={addHook}
              disabled={
                !(newHook.type === 'http' ? newHook.url : newHook.command)
              }
              className={cn(
                'bg-primary text-primary-foreground cursor-pointer rounded-md px-3 py-1.5 text-xs',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {t.settings.addRule}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className={cn(
            'border-border flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-2 text-xs',
            'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          <Plus className="size-3" />
          {t.settings.addHook}
        </button>
      )}
    </div>
  );
}
