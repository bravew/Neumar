import { getSetting } from '@/shared/db/operations';

export const RESEARCH_TOOL_FLAG = 'NEUMA_AGENT_RESEARCH';

export function isResearchToolEnabled(): boolean {
  const raw = getSetting(RESEARCH_TOOL_FLAG) ?? process.env[RESEARCH_TOOL_FLAG];
  if (raw === undefined || raw === null || raw === '') return false;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(
    String(raw).toLowerCase(),
  );
}
