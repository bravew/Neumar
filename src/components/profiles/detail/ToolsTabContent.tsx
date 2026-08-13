import { useMcpServers } from '@/shared/hooks/useMcpServers';
import { useSkills } from '@/shared/hooks/useSkills';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { McpSkillsPicker } from '../McpSkillsPicker';
import { INPUT_CLASS, LABEL_CLASS } from '../profile-constants';

interface ToolsTabContentProps {
  selectedMcp: string[];
  selectedSkills: string[] | null;
  maxConcurrentTasks: number;
  onToggleMcp: (id: string) => void;
  onToggleSkill: (id: string) => void;
  onAllowAllSkillsChange: (allowAll: boolean) => void;
  onMaxTasksChange: (n: number) => void;
}

export function ToolsTabContent({
  selectedMcp,
  selectedSkills,
  maxConcurrentTasks,
  onToggleMcp,
  onToggleSkill,
  onAllowAllSkillsChange,
  onMaxTasksChange,
}: ToolsTabContentProps) {
  const { t } = useLanguage();
  const { servers: mcpServers } = useMcpServers();
  const { skills } = useSkills();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* MCP Servers & Skills — grows to fill available space */}
      <McpSkillsPicker
        mcpServers={mcpServers}
        skills={skills}
        selectedMcp={selectedMcp}
        selectedSkills={selectedSkills}
        onToggleMcp={onToggleMcp}
        onToggleSkill={onToggleSkill}
        onAllowAllSkillsChange={onAllowAllSkillsChange}
        t={t}
      />

      {/* Max Concurrent Tasks — fixed at bottom */}
      <div className="shrink-0">
        <label className={LABEL_CLASS}>{t.profiles.maxConcurrentTasks}</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={10}
            value={maxConcurrentTasks}
            onChange={(e) =>
              onMaxTasksChange(Math.max(1, parseInt(e.target.value, 10) || 1))
            }
            className={cn(INPUT_CLASS, 'w-24')}
          />
          <p className="text-muted-foreground text-xs">
            {t.profiles.maxConcurrentTasksDesc}
          </p>
        </div>
      </div>
    </div>
  );
}
