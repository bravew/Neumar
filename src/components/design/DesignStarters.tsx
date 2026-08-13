import type { DesignSurface } from '@/shared/types/design-mode';

/**
 * Empty-conversation starter cards — Studio parity (Fix-sync Phase 04).
 * Mirrors Open Design's "Start a conversation" cards: click-to-fill example
 * prompts keyed by the project surface. Example bodies stay in English (they
 * are illustrative prompts, like the upstream cards); only the section title
 * is localized by the caller.
 */

interface Starter {
  title: string;
  tag: string;
  prompt: string;
}

const PROTOTYPE_STARTERS: Starter[] = [
  {
    title: 'SaaS analytics dashboard',
    tag: 'Data',
    prompt:
      'A dense analytics dashboard for a developer-tools SaaS — KPI strip with week-over-week deltas, two stacked line charts (MRR and active workspaces), a cohort retention grid, a top-customers leaderboard, and a real-time event feed. Dark theme, tabular monospace numerals, sparkline accents.',
  },
  {
    title: 'Mobile onboarding flow',
    tag: 'Mobile',
    prompt:
      'A three-screen mobile onboarding flow — splash with logo, a value-proposition carousel with progress dots, and a sign-in screen with social buttons. iPhone frame, generous spacing, friendly rounded components.',
  },
  {
    title: 'Pricing page',
    tag: 'Marketing',
    prompt:
      'A pricing page with three tiers (Free, Pro, Team), a monthly/annual toggle, a feature comparison table, and a closing FAQ. Clear hierarchy, one highlighted recommended plan, crisp CTAs.',
  },
];

const DECK_STARTERS: Starter[] = [
  {
    title: 'Editorial pitch deck',
    tag: 'Magazine',
    prompt:
      'A 10-slide editorial pitch deck for a design studio raising a seed round — Swiss-grid layout, oversized serif headlines with bold drop caps, monospace section numbers, generous negative space. Cover, vision, market, product, traction, team, ask, contact.',
  },
  {
    title: 'Weekly update',
    tag: 'Internal',
    prompt:
      'A 6-slide weekly team update — highlights, metrics with deltas, shipped work, risks, next week, and asks. Clean, scannable, one idea per slide.',
  },
];

const DOCUMENT_STARTERS: Starter[] = [
  {
    title: 'Product brief',
    tag: 'Product',
    prompt:
      'A one-page product brief — problem, target user, proposed solution, success metrics, scope, and open questions. Tight, decision-oriented prose.',
  },
  {
    title: 'Annual report long-scroll',
    tag: 'Editorial',
    prompt:
      'An interactive annual-report long-scroll — big pull-quote blocks, animated counters, a few charts, photography breakers, and a closing call-to-action. Modern serif body, earthy palette.',
  },
];

function startersForSurface(surface: DesignSurface): Starter[] {
  switch (surface) {
    case 'deck':
      return DECK_STARTERS;
    case 'document':
    case 'campaign':
      return DOCUMENT_STARTERS;
    case 'prototype':
    case 'template':
      return PROTOTYPE_STARTERS;
    default:
      // image / video / audio lean on the prompt library instead.
      return [];
  }
}

export function DesignStarters({
  surface,
  title,
  onSelect,
}: {
  surface: DesignSurface;
  title: string;
  onSelect: (prompt: string) => void;
}) {
  const starters = startersForSurface(surface);
  if (starters.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="design-starters">
      <p className="text-foreground text-sm font-medium">{title}</p>
      <ul className="space-y-1.5">
        {starters.map((starter) => (
          <li key={starter.title}>
            <button
              type="button"
              onClick={() => onSelect(starter.prompt)}
              className="border-border hover:bg-accent group flex w-full items-start gap-3 rounded-md border p-2.5 text-left transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground truncate text-sm font-medium">
                    {starter.title}
                  </span>
                  <span className="text-muted-foreground bg-muted shrink-0 rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                    {starter.tag}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                  {starter.prompt}
                </p>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs opacity-0 transition-opacity group-hover:opacity-100">
                ↵
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
