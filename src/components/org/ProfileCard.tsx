import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface AgentProfile {
  id: string;
  name: string;
  role: string | null;
  status: 'active' | 'paused' | 'archived';
  avatar_icon: string | null;
  avatar_color: string | null;
}

interface ProfileCardProps {
  profile: AgentProfile;
  taskCount?: number;
  budgetUsed?: number;
  budgetLimit?: number;
  onClick?: () => void;
}

// circumference = 2 * π * 16 ≈ 100.53
const CIRC = 100.53;

export function ProfileCard({
  profile,
  taskCount = 0,
  budgetUsed = 0,
  budgetLimit,
  onClick,
}: ProfileCardProps) {
  const { t } = useLanguage();
  const pct =
    budgetLimit && budgetLimit > 0 ? Math.min(budgetUsed / budgetLimit, 1) : 0;
  const dashOffset = CIRC * (1 - pct);

  const statusColor =
    profile.status === 'active'
      ? 'bg-green-500'
      : profile.status === 'paused'
        ? 'bg-amber-500'
        : 'bg-gray-400';

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-card border-border rounded-xl border p-4 transition-shadow hover:shadow-md',
        onClick && 'cursor-pointer',
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        {/* Avatar */}
        <div
          className="flex size-10 items-center justify-center rounded-full text-lg text-white"
          style={{ backgroundColor: profile.avatar_color ?? '#6366f1' }}
        >
          {profile.avatar_icon ?? '🤖'}
        </div>
        {/* Status */}
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              'size-2 rounded-full',
              statusColor,
              profile.status === 'active' && 'animate-pulse',
            )}
          />
          <span className="text-muted-foreground text-xs capitalize">
            {profile.status}
          </span>
        </div>
      </div>

      {/* Name & role */}
      <h3 className="text-foreground truncate font-semibold">{profile.name}</h3>
      {profile.role && (
        <p className="text-muted-foreground mt-0.5 truncate text-sm">
          {profile.role}
        </p>
      )}

      {/* Stats row */}
      <div className="mt-3 flex items-center justify-between">
        {/* Task count */}
        {taskCount > 0 && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            {t.profiles.taskCount.replace('{count}', String(taskCount))}
          </span>
        )}

        {/* Budget ring */}
        {budgetLimit && budgetLimit > 0 && (
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle
              cx="20"
              cy="20"
              r="16"
              fill="none"
              stroke="var(--muted)"
              strokeWidth="4"
            />
            <circle
              cx="20"
              cy="20"
              r="16"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="4"
              strokeDasharray={CIRC}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 20 20)"
            />
            <text
              x="20"
              y="24"
              textAnchor="middle"
              fontSize="9"
              fill="var(--foreground)"
            >
              {Math.round(pct * 100)}%
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}
