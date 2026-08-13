import type { PanelistView } from '../critique-reducer';
import { JuryMustFixList } from './JuryMustFixList';
import { JuryPanelistAppear } from './JuryPanelistAppear';
import { JuryPanelistDim } from './JuryPanelistDim';

const ROLE_TONE: Record<string, string> = {
  designer: 'border-l-sky-500',
  critic: 'border-l-rose-500',
  brand: 'border-l-violet-500',
  accessibility: 'border-l-emerald-500',
  copy: 'border-l-amber-500',
};

export function JuryPanelistCard({
  panelist,
  roleLabel,
  scoreLabel,
  mustFixLabel,
}: {
  panelist: PanelistView;
  roleLabel: string;
  scoreLabel: string;
  mustFixLabel: string;
}) {
  return (
    <JuryPanelistAppear>
      <JuryPanelistDim dimmed={panelist.status !== 'open'}>
        <article
          className={`bg-surface rounded-md border border-l-4 p-3 ${ROLE_TONE[panelist.role] ?? 'border-l-muted-foreground'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <h5 className="text-sm font-medium">{roleLabel}</h5>
            {panelist.rating != null && (
              <span className="bg-surface-warm rounded px-2 py-1 text-xs">
                {scoreLabel.replace('{score}', String(panelist.rating))}
              </span>
            )}
          </div>
          <JuryMustFixList title={mustFixLabel} items={panelist.mustFix} />
        </article>
      </JuryPanelistDim>
    </JuryPanelistAppear>
  );
}
