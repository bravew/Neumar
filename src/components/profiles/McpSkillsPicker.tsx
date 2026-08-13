/**
 * MCP Servers + Skills multi-select picker for profile dialog.
 * Supports "Allow All" mode (null = no restrictions) and individual selection.
 */

import { useMemo } from 'react';

import { AlertTriangle, Check, Info, ShieldCheck } from 'lucide-react';

import type { McpServerInfo } from '@/shared/hooks/useMcpServers';
import type { SkillInfo } from '@/shared/hooks/useSkills';
import { cn } from '@/shared/lib/utils';

import { LABEL_CLASS } from './profile-constants';

export function McpSkillsPicker({
  mcpServers,
  skills,
  selectedMcp,
  selectedSkills,
  onToggleMcp,
  onToggleSkill,
  onAllowAllSkillsChange,
  t,
}: {
  mcpServers: McpServerInfo[];
  skills: SkillInfo[];
  selectedMcp: string[];
  /** null = allow all, string[] = specific selection */
  selectedSkills: string[] | null;
  onToggleMcp: (name: string) => void;
  onToggleSkill: (slug: string) => void;
  onAllowAllSkillsChange: (allowAll: boolean) => void;
  t: {
    profiles: {
      mcpServers: string;
      skills: string;
      skillsAllAllowed: string;
      skillsRestrict: string;
      skillsAllAllowedDesc: string;
      skillStaleRemove: string;
      skillsNoneInstalled: string;
    };
  };
}) {
  const allowAll = selectedSkills === null;
  const skillsList = useMemo(() => selectedSkills ?? [], [selectedSkills]);

  const knownSlugs = useMemo(
    () => new Set(skills.map((s) => s.slug)),
    [skills],
  );
  const validSelectedCount = useMemo(
    () => skillsList.filter((s) => knownSlugs.has(s)).length,
    [skillsList, knownSlugs],
  );
  const staleSlugs = useMemo(
    () => skillsList.filter((s) => !knownSlugs.has(s)),
    [skillsList, knownSlugs],
  );
  const selectedMcpCount = selectedMcp.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Skills section — grows to fill available space */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center justify-between">
          <label className={cn(LABEL_CLASS, 'mb-0')}>
            {t.profiles.skills}
            {!allowAll && validSelectedCount > 0 && (
              <span className="text-foreground/70 ml-1.5">
                ({validSelectedCount}/{skills.length})
              </span>
            )}
          </label>
          {/* Allow All toggle */}
          <button
            type="button"
            onClick={() => onAllowAllSkillsChange(!allowAll)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              allowAll
                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <ShieldCheck className="size-3.5" />
            {allowAll ? t.profiles.skillsAllAllowed : t.profiles.skillsRestrict}
          </button>
        </div>

        {allowAll ? (
          /* Allow All mode — informational display */
          <div className="bg-primary/5 border-primary/20 rounded-lg border px-3 py-2.5">
            <p className="text-foreground/80 text-xs">
              {t.profiles.skillsAllAllowedDesc}
            </p>
          </div>
        ) : (
          /* Individual selection mode */
          <>
            {skills.length > 0 ? (
              <div className="bg-background border-input overflow-y-auto rounded-lg border p-1.5">
                {skills.map((skill) => {
                  const isSelected = skillsList.includes(skill.slug);
                  return (
                    <button
                      key={skill.slug}
                      type="button"
                      onClick={() => onToggleSkill(skill.slug)}
                      title={skill.description || undefined}
                      className={cn(
                        'hover:bg-accent group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                        isSelected && 'bg-accent/50',
                      )}
                    >
                      <div
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/40 bg-background',
                        )}
                      >
                        {isSelected && <Check className="size-3" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-foreground truncate text-sm font-medium">
                            {skill.name}
                          </span>
                          {skill.trigger && (
                            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
                              {skill.trigger}
                            </span>
                          )}
                        </div>
                        {skill.description && (
                          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                            {skill.description}
                          </p>
                        )}
                      </div>
                      {skill.description && (
                        <Info className="text-muted-foreground/50 group-hover:text-muted-foreground size-3.5 shrink-0 transition-colors" />
                      )}
                    </button>
                  );
                })}

                {/* Stale/unrecognized skill slugs */}
                {staleSlugs.map((slug) => (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => onToggleSkill(slug)}
                    title={t.profiles.skillStaleRemove}
                    className="hover:bg-destructive/10 group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors"
                  >
                    <div className="border-destructive/40 bg-destructive/10 text-destructive flex size-4 shrink-0 items-center justify-center rounded border">
                      <Check className="size-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground truncate text-sm line-through">
                          {slug}
                        </span>
                      </div>
                      <p className="text-destructive/70 mt-0.5 text-xs">
                        {t.profiles.skillStaleRemove}
                      </p>
                    </div>
                    <AlertTriangle className="text-destructive/50 size-3.5 shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                {t.profiles.skillsNoneInstalled}
              </p>
            )}
          </>
        )}
      </div>

      {/* MCP Servers section */}
      {mcpServers.length > 0 && (
        <div>
          <label className={LABEL_CLASS}>
            {t.profiles.mcpServers}
            {selectedMcpCount > 0 && (
              <span className="text-foreground/70 ml-1.5">
                ({selectedMcpCount}/{mcpServers.length})
              </span>
            )}
          </label>
          <div className="bg-background border-input min-h-0 flex-1 overflow-y-auto rounded-lg border p-1.5">
            {mcpServers.map((server) => {
              const isSelected = selectedMcp.includes(server.name);
              return (
                <button
                  key={`${server.source}-${server.name}`}
                  type="button"
                  onClick={() => onToggleMcp(server.name)}
                  title={`${server.name} (${server.type})`}
                  className={cn(
                    'hover:bg-accent flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    isSelected && 'bg-accent/50',
                  )}
                >
                  <div
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40 bg-background',
                    )}
                  >
                    {isSelected && <Check className="size-3" />}
                  </div>
                  <div className="flex size-5 shrink-0 items-center justify-center">
                    {server.icon ? (
                      <img
                        src={server.icon}
                        alt=""
                        className="size-4 rounded object-contain"
                      />
                    ) : (
                      <div className="bg-muted text-muted-foreground flex size-4 items-center justify-center rounded text-[9px] font-medium uppercase">
                        {server.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span className="text-foreground flex-1 truncate text-sm">
                    {server.name}
                  </span>
                  <span className="text-muted-foreground/60 shrink-0 text-[10px] uppercase">
                    {server.type}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
