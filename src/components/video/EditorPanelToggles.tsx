import { Bot, PanelLeft } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

interface EditorPanelTogglesProps {
  sideRailOpen: boolean;
  agentDockOpen: boolean;
  onToggleSideRail: () => void;
  onToggleAgentDock: () => void;
}

/**
 * Compact icon buttons used in the stepper toolbar to toggle side rail,
 * inspector, and agent dock visibility. Extracted from ProjectEditor to keep
 * the file under the 350-line component-size cap.
 */
export function EditorPanelToggles({
  sideRailOpen,
  agentDockOpen,
  onToggleSideRail,
  onToggleAgentDock,
}: EditorPanelTogglesProps) {
  const { t } = useLanguage();
  const buttonClass = (active: boolean) =>
    active
      ? 'bg-accent text-foreground hover:bg-accent rounded-md p-1.5'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground rounded-md p-1.5';

  return (
    <>
      <button
        type="button"
        aria-pressed={sideRailOpen}
        title={t.video.editor.sideRail.toggle}
        className={buttonClass(sideRailOpen)}
        onClick={onToggleSideRail}
      >
        <PanelLeft className="size-3.5" />
        <span className="sr-only">{t.video.editor.sideRail.toggle}</span>
      </button>
      <button
        type="button"
        aria-pressed={agentDockOpen}
        title={t.video.editor.agentDock.toggle}
        className={buttonClass(agentDockOpen)}
        onClick={onToggleAgentDock}
      >
        <Bot className="size-3.5" />
        <span className="sr-only">{t.video.editor.agentDock.toggle}</span>
      </button>
    </>
  );
}
