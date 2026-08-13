/**
 * Brand icon for a local agent runtime / model provider row.
 *
 * Vendor SVG marks are bundled under `src/assets/agent-icons/` (provenance:
 * `dev-doc/plan/07-09-agent-runtime/icon-provenance.md`). All marks render at
 * their fixed brand colors; unknown runtimes fall back to a neutral glyph so
 * future runtimes never render as a broken image.
 */

import type { ComponentType, SVGProps } from 'react';

import { Bot } from 'lucide-react';

import ClaudeBrand from '@/assets/agent-icons/claude.svg?react';
import CodexBrand from '@/assets/agent-icons/codex.svg?react';
import CopilotBrand from '@/assets/agent-icons/copilot.svg?react';
import CursorAgentBrand from '@/assets/agent-icons/cursor-agent.svg?react';
import QwenBrand from '@/assets/agent-icons/qwen.svg?react';
import { cn } from '@/shared/lib/utils';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const RUNTIME_ICONS: Record<string, IconComponent> = {
  claude: ClaudeBrand,
  codex: CodexBrand,
  'cursor-agent': CursorAgentBrand,
  qwen: QwenBrand,
  copilot: CopilotBrand,
};

interface AgentRuntimeIconProps {
  /** Canonical runtime/provider id (`claude`, `codex`, `cursor-agent`, …). */
  runtimeId: string;
  className?: string;
}

export function AgentRuntimeIcon({
  runtimeId,
  className,
}: AgentRuntimeIconProps) {
  const Icon = RUNTIME_ICONS[runtimeId] ?? Bot;
  return <Icon className={cn('size-4 shrink-0', className)} aria-hidden />;
}
