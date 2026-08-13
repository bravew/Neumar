/**
 * Avatar configuration for agent profiles using Lucide role-based icons.
 *
 * Each agent gets a meaningful icon reflecting its role/function rendered on a
 * colored background — instantly communicating what the agent does at a glance.
 *
 * The icon key is stored in `avatar_icon` (DB column).
 * Background color is stored in `avatar_color`.
 */

import {
  Activity,
  Anchor,
  BarChart3,
  BookOpen,
  Bot,
  BrainCircuit,
  Briefcase,
  Bug,
  Calculator,
  Calendar,
  Camera,
  CircuitBoard,
  Clipboard,
  Cloud,
  Code2,
  Compass,
  Container,
  Cpu,
  Database,
  FileSearch,
  FileText,
  Flame,
  FlaskConical,
  Globe,
  GraduationCap,
  Hammer,
  Headphones,
  Heart,
  Languages,
  LayoutDashboard,
  Library,
  Lightbulb,
  Mail,
  Map,
  MessageCircle,
  Microscope,
  Music,
  Network,
  Palette,
  PenTool,
  Phone,
  PieChart,
  Podcast,
  Presentation,
  Rocket,
  ScanEye,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Store,
  Target,
  Terminal,
  TestTube2,
  Ticket,
  TrendingUp,
  Users,
  Video,
  Wand2,
  Wrench,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

// ============================================================================
// Avatar icon options — each maps to a Lucide icon component
// ============================================================================

export interface AvatarOption {
  /** Stored in DB `avatar_icon` column */
  seed: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Curated set of role-specific icons. Organized into logical groups:
 * AI/General → Development → Analysis → Creative → Communication →
 * Operations → Domain-specific → Misc.
 */
export const AVATAR_OPTIONS: AvatarOption[] = [
  // ── AI & General ──
  { seed: 'sparkles', label: 'Assistant', icon: Sparkles },
  { seed: 'zap', label: 'Workhorse', icon: Zap },
  { seed: 'bot', label: 'Bot', icon: Bot },
  { seed: 'brain-circuit', label: 'AI/ML', icon: BrainCircuit },
  { seed: 'lightbulb', label: 'Ideas', icon: Lightbulb },
  { seed: 'wand-2', label: 'Magic', icon: Wand2 },

  // ── Development ──
  { seed: 'code-2', label: 'Developer', icon: Code2 },
  { seed: 'terminal', label: 'Terminal', icon: Terminal },
  { seed: 'bug', label: 'Debugger', icon: Bug },
  { seed: 'circuit-board', label: 'Hardware', icon: CircuitBoard },
  { seed: 'container', label: 'Container', icon: Container },
  { seed: 'cpu', label: 'Compute', icon: Cpu },
  { seed: 'database', label: 'Database', icon: Database },

  // ── Review & Security ──
  { seed: 'scan-eye', label: 'Reviewer', icon: ScanEye },
  { seed: 'shield-check', label: 'Security', icon: ShieldCheck },
  { seed: 'shield', label: 'Guard', icon: Shield },
  { seed: 'file-search', label: 'Audit', icon: FileSearch },

  // ── Analysis & Data ──
  { seed: 'bar-chart-3', label: 'Analytics', icon: BarChart3 },
  { seed: 'pie-chart', label: 'Charts', icon: PieChart },
  { seed: 'trending-up', label: 'Growth', icon: TrendingUp },
  { seed: 'microscope', label: 'Research', icon: Microscope },
  { seed: 'flask-conical', label: 'Lab', icon: FlaskConical },
  { seed: 'calculator', label: 'Math', icon: Calculator },
  { seed: 'activity', label: 'Monitor', icon: Activity },

  // ── Testing & QA ──
  { seed: 'test-tube-2', label: 'Testing', icon: TestTube2 },
  { seed: 'clipboard', label: 'Checklist', icon: Clipboard },

  // ── Planning & Management ──
  { seed: 'target', label: 'Product', icon: Target },
  { seed: 'compass', label: 'Planner', icon: Compass },
  { seed: 'map', label: 'Roadmap', icon: Map },
  { seed: 'calendar', label: 'Schedule', icon: Calendar },
  { seed: 'briefcase', label: 'Business', icon: Briefcase },
  { seed: 'presentation', label: 'Presenter', icon: Presentation },

  // ── Writing & Creative ──
  { seed: 'pen-tool', label: 'Writer', icon: PenTool },
  { seed: 'book-open', label: 'Docs', icon: BookOpen },
  { seed: 'file-text', label: 'Content', icon: FileText },
  { seed: 'palette', label: 'Design', icon: Palette },
  { seed: 'camera', label: 'Visual', icon: Camera },
  { seed: 'video', label: 'Video', icon: Video },
  { seed: 'music', label: 'Audio', icon: Music },

  // ── Communication ──
  { seed: 'message-circle', label: 'Chat', icon: MessageCircle },
  { seed: 'mail', label: 'Email', icon: Mail },
  { seed: 'phone', label: 'Support', icon: Phone },
  { seed: 'headphones', label: 'Listen', icon: Headphones },
  { seed: 'podcast', label: 'Podcast', icon: Podcast },
  { seed: 'languages', label: 'Translate', icon: Languages },

  // ── Operations & Infra ──
  { seed: 'settings', label: 'Ops', icon: Settings },
  { seed: 'rocket', label: 'DevOps', icon: Rocket },
  { seed: 'cloud', label: 'Cloud', icon: Cloud },
  { seed: 'network', label: 'Network', icon: Network },
  { seed: 'hammer', label: 'Build', icon: Hammer },
  { seed: 'wrench', label: 'Tools', icon: Wrench },
  { seed: 'flame', label: 'Fire', icon: Flame },

  // ── Domain-specific ──
  { seed: 'search', label: 'Search', icon: Search },
  { seed: 'globe', label: 'Web', icon: Globe },
  { seed: 'users', label: 'Team', icon: Users },
  { seed: 'store', label: 'Commerce', icon: Store },
  { seed: 'graduation-cap', label: 'Education', icon: GraduationCap },
  { seed: 'stethoscope', label: 'Health', icon: Stethoscope },
  { seed: 'heart', label: 'Care', icon: Heart },
  { seed: 'ticket', label: 'Ticket', icon: Ticket },
  { seed: 'library', label: 'Knowledge', icon: Library },
  { seed: 'layout-dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { seed: 'anchor', label: 'Anchor', icon: Anchor },
];

/** Lookup map for O(1) icon resolution. */
const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  AVATAR_OPTIONS.map((o) => [o.seed, o.icon]),
);

/** Resolve a stored icon key to its Lucide component. Falls back to Sparkles. */
export function resolveIcon(avatarId: string | null): LucideIcon {
  if (!avatarId) return Sparkles;
  return ICON_MAP[avatarId] ?? Sparkles;
}

/** Preset background colors. */
export const AVATAR_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#1e293b',
];

/**
 * Default icon for each role preset (matches profile-constants.ts values).
 * Used when auto-assigning avatars on profile creation.
 */
export const ROLE_DEFAULT_ICONS: Record<string, string> = {
  'Code Reviewer': 'scan-eye',
  'Software Engineer': 'code-2',
  'Technical Writer': 'book-open',
  'Research Assistant': 'search',
  'Data Analyst': 'bar-chart-3',
  'UI/UX Developer': 'palette',
  'Project Planner': 'compass',
  'Test Engineer': 'test-tube-2',
  'Security Auditor': 'shield-check',
  'DevOps Engineer': 'rocket',
};

/**
 * Default avatar (icon + color) for each soul template ID.
 * Used by the quickstart wizard and profile creation from templates.
 */
export const TEMPLATE_AVATARS: Record<string, { icon: string; color: string }> =
  {
    'fullstack-developer': { icon: 'code-2', color: '#6366f1' },
    'code-reviewer': { icon: 'scan-eye', color: '#8b5cf6' },
    'qa-engineer': { icon: 'test-tube-2', color: '#14b8a6' },
    'strategic-leader': { icon: 'compass', color: '#f97316' },
    'creative-writer': { icon: 'pen-tool', color: '#ec4899' },
    'security-auditor': { icon: 'shield-check', color: '#ef4444' },
    'research-analyst': { icon: 'microscope', color: '#06b6d4' },
    'data-analyst': { icon: 'bar-chart-3', color: '#22c55e' },
    'general-assistant': { icon: 'sparkles', color: '#3b82f6' },
    'ops-engineer': { icon: 'settings', color: '#eab308' },
    'product-manager': { icon: 'target', color: '#a855f7' },
    'neumar-default': { icon: 'zap', color: '#1e293b' },
    custom: { icon: 'wrench', color: '#6366f1' },
  };

export const DEFAULT_AVATAR = { icon: 'sparkles', color: '#6366f1' };

// ============================================================================
// React components
// ============================================================================

/** Full avatar with background color — cards, preview, sidebar. */
export function AvatarSvg({
  avatarId,
  color,
  className,
}: {
  avatarId: string | null;
  color?: string;
  className?: string;
}) {
  const Icon = resolveIcon(avatarId);
  return (
    <div
      className={cn('flex items-center justify-center rounded-xl', className)}
      style={{ backgroundColor: color || '#6366f1' }}
    >
      <Icon
        className="size-[58%] text-white drop-shadow-sm"
        strokeWidth={1.8}
      />
    </div>
  );
}

/** Small avatar preview without background — picker grid. */
export function AvatarPreview({
  seed,
  className,
}: {
  seed: string;
  className?: string;
}) {
  const Icon = resolveIcon(seed);
  return (
    <div
      className={cn('flex items-center justify-center rounded-lg', className)}
    >
      <Icon className="text-muted-foreground size-[55%]" strokeWidth={1.8} />
    </div>
  );
}
