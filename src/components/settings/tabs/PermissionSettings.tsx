import { useCallback, useEffect, useState } from 'react';

import { HelpCircle, Plus, ShieldCheck, ShieldX, Trash2 } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { API_BASE_URL } from '../constants';
import type { SettingsTabProps } from '../types';
import {
  FilesystemRuleSection,
  type FilesystemRule,
} from './PermissionFilesystemRules';

// ── Types ────────────────────────────────────────────────────────────────────

interface PermissionRules {
  alwaysAllow: string[];
  alwaysDeny: string[];
  alwaysAsk: string[];
  filesystem?: FilesystemRule[];
}

/**
 * Built-in tools that are safe to auto-allow for new users.
 * Excludes 'execute' classified tools (Bash, Task) which require explicit approval.
 */
const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'LSP',
  'Skill',
  'Edit',
  'Write',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
];

const DEFAULT_RULES: PermissionRules = {
  alwaysAllow: [...DEFAULT_ALLOWED_TOOLS],
  alwaysDeny: [],
  alwaysAsk: [],
  filesystem: [],
};

// All built-in tools for the dropdown (includes execute-class tools)
const BUILT_IN_TOOLS = [...DEFAULT_ALLOWED_TOOLS, 'Bash', 'Task'];

type RuleCategory = 'alwaysAllow' | 'alwaysDeny' | 'alwaysAsk';

// ── Main Component ───────────────────────────────────────────────────────────

export function PermissionSettings({
  settings: _settings,
  onSettingsChange: _onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const [rules, setRules] = useState<PermissionRules>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [newInputs, setNewInputs] = useState<Record<RuleCategory, string>>({
    alwaysAllow: '',
    alwaysDeny: '',
    alwaysAsk: '',
  });
  // Load rules from backend
  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE_URL}/db/settings/toolPermissionRules`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.value) {
          try {
            const parsed = JSON.parse(data.value);
            setRules({
              alwaysAllow: parsed.alwaysAllow ?? [],
              alwaysDeny: parsed.alwaysDeny ?? [],
              alwaysAsk: parsed.alwaysAsk ?? [],
              filesystem: parsed.filesystem ?? [],
            });
          } catch {
            // Invalid JSON — use defaults
          }
        }
      })
      .catch(() => {
        // Network error — use defaults
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  // Save rules to backend
  const saveRules = useCallback((updated: PermissionRules) => {
    setRules(updated);
    fetch(`${API_BASE_URL}/db/settings/toolPermissionRules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(updated) }),
    }).catch(() => {
      // Save failed silently — rules will reload on next open
    });
  }, []);

  const addRule = useCallback(
    (category: RuleCategory) => {
      const value = newInputs[category].trim();
      if (!value) return;
      setRules((prev) => {
        if (prev[category].includes(value)) return prev;
        const updated = { ...prev, [category]: [...prev[category], value] };
        saveRules(updated);
        return updated;
      });
      setNewInputs((prev) => ({ ...prev, [category]: '' }));
    },
    [newInputs, saveRules],
  );

  const removeRule = useCallback(
    (category: RuleCategory, index: number) => {
      setRules((prev) => {
        const updated = {
          ...prev,
          [category]: prev[category].filter((_, i) => i !== index),
        };
        saveRules(updated);
        return updated;
      });
    },
    [saveRules],
  );

  if (loading) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-muted-foreground text-sm">
        {t.settings.permissionRulesDescription}
      </p>

      <RuleSection
        category="alwaysAllow"
        title={t.settings.alwaysAllow}
        description={t.settings.alwaysAllowDescription}
        icon={<ShieldCheck className="size-4 text-green-500" />}
        rules={rules.alwaysAllow}
        inputValue={newInputs.alwaysAllow}
        onInputChange={(v) =>
          setNewInputs((prev) => ({ ...prev, alwaysAllow: v }))
        }
        onAdd={() => addRule('alwaysAllow')}
        onRemove={(i) => removeRule('alwaysAllow', i)}
        t={t}
      />

      <RuleSection
        category="alwaysDeny"
        title={t.settings.alwaysDeny}
        description={t.settings.alwaysDenyDescription}
        icon={<ShieldX className="size-4 text-red-500" />}
        rules={rules.alwaysDeny}
        inputValue={newInputs.alwaysDeny}
        onInputChange={(v) =>
          setNewInputs((prev) => ({ ...prev, alwaysDeny: v }))
        }
        onAdd={() => addRule('alwaysDeny')}
        onRemove={(i) => removeRule('alwaysDeny', i)}
        t={t}
      />

      <RuleSection
        category="alwaysAsk"
        title={t.settings.alwaysAsk}
        description={t.settings.alwaysAskDescription}
        icon={<HelpCircle className="size-4 text-amber-500" />}
        rules={rules.alwaysAsk}
        inputValue={newInputs.alwaysAsk}
        onInputChange={(v) =>
          setNewInputs((prev) => ({ ...prev, alwaysAsk: v }))
        }
        onAdd={() => addRule('alwaysAsk')}
        onRemove={(i) => removeRule('alwaysAsk', i)}
        t={t}
      />

      <FilesystemRuleSection rules={rules.filesystem ?? []} />

      {/* Rule format help */}
      <div className="bg-muted/50 rounded-lg p-4">
        <p className="text-muted-foreground mb-2 text-xs font-medium">
          {t.settings.ruleFormatHelp}
        </p>
        <div className="text-muted-foreground space-y-1 font-mono text-xs">
          <p>
            <code className="bg-muted rounded px-1">Bash</code> —{' '}
            {t.settings.ruleFormatToolOnly}
          </p>
          <p>
            <code className="bg-muted rounded px-1">Bash(git *)</code> —{' '}
            {t.settings.ruleFormatWithPattern}
          </p>
          <p>
            <code className="bg-muted rounded px-1">Read(src/**)</code> —{' '}
            {t.settings.ruleFormatPathPattern}
          </p>
          <p>
            <code className="bg-muted rounded px-1">mcp__*</code> —{' '}
            {t.settings.ruleFormatWildcard}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Rule Section ─────────────────────────────────────────────────────────────

function RuleSection({
  category,
  title,
  description,
  icon,
  rules,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  t,
}: {
  category: RuleCategory;
  title: string;
  description: string;
  icon: React.ReactNode;
  rules: string[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  const listId = `tools-${category}`;
  const suggestions = BUILT_IN_TOOLS.filter((tool) => !rules.includes(tool));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="text-muted-foreground text-xs">{description}</p>

      {/* Rule list */}
      {rules.length > 0 && (
        <div className="space-y-1">
          {rules.map((rule, i) => (
            <div
              key={`${rule}-${i}`}
              className={cn(
                'bg-muted/50 flex items-center justify-between rounded-md px-3 py-1.5',
                'group hover:bg-muted',
              )}
            >
              <code className="text-xs">{rule}</code>
              <button
                onClick={() => onRemove(i)}
                className="text-muted-foreground hover:text-destructive cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
                title={t.settings.removeRule}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add rule input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAdd();
            }}
            placeholder={t.settings.addRulePlaceholder}
            list={listId}
            className={cn(
              'border-border bg-background w-full rounded-md border px-3 py-1.5 text-xs',
              'focus:ring-ring focus:border-ring focus:ring-1 focus:outline-none',
            )}
          />
          <datalist id={listId}>
            {suggestions.map((tool) => (
              <option key={tool} value={tool} />
            ))}
          </datalist>
        </div>
        <button
          onClick={onAdd}
          disabled={!inputValue.trim()}
          className={cn(
            'border-border flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-xs',
            'hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Plus className="size-3" />
          {t.settings.addRule}
        </button>
      </div>
    </div>
  );
}
