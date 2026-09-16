import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoFramework,
  VideoFrameworkSectionRole,
} from '@/shared/types/video';

const ROLES: VideoFrameworkSectionRole[] = [
  'hook',
  'premise',
  'context',
  'proof',
  'escalation',
  'turn',
  'demonstration',
  'payoff',
  'cta',
  'outro',
];

export interface FrameworkReviewPanelProps {
  framework: VideoFramework | null;
  stale?: boolean;
  onChangeRole?: (sectionId: string, role: VideoFrameworkSectionRole) => void;
}

export function FrameworkReviewPanel({
  framework,
  stale = false,
  onChangeRole,
}: FrameworkReviewPanelProps) {
  const { t } = useLanguage();
  const copy = t.video.reference.framework;
  if (!framework) {
    return <p className="text-muted-foreground text-xs">{copy.empty}</p>;
  }
  return (
    <div className="space-y-3 text-xs">
      {stale ? (
        <p className="text-amber-700 dark:text-amber-400">{copy.stale}</p>
      ) : null}
      <p className="font-medium">
        {framework.displayName} · {copy.confidence}{' '}
        {framework.confidence.toFixed(2)}
      </p>
      <ol className="space-y-2">
        {framework.sections.map((section) => (
          <li
            key={section.id}
            className="border-border space-y-1 rounded border p-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">
                {copy.roles[section.role]} ·{' '}
                {Math.round(section.timing.proportion * 100)}%
              </p>
              <span>
                {copy.confidence} {section.confidence.toFixed(2)}
              </span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded">
              <span
                className="bg-foreground block h-full"
                style={{ width: `${section.timing.proportion * 100}%` }}
              />
            </div>
            <p>{section.purpose}</p>
            <p className="text-muted-foreground">
              {copy.slots}: {section.slots.map((slot) => slot.kind).join(', ')}
            </p>
            <p className="text-muted-foreground">
              {copy.systems}:{' '}
              {section.systemIds.length > 0
                ? section.systemIds.join(', ')
                : copy.none}
            </p>
            {onChangeRole ? (
              <div className="flex flex-wrap gap-1">
                {ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className="border-border hover:bg-accent rounded border px-1.5 py-0.5"
                    aria-pressed={section.role === role}
                    onClick={() => onChangeRole(section.id, role)}
                  >
                    {copy.roles[role]}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
