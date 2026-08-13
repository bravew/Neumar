import { useMemo } from 'react';

import { CreativeWorkflowHeader } from '@/components/creative/CreativeWorkflowHeader';
import { deriveDesignCreativeWorkflowState } from '@/shared/creative-workflow';
import type { CreativeWorkflowAction } from '@/shared/creative-workflow';
import type { DesignProject } from '@/shared/types/design-mode';

interface ProjectViewWorkflowHeaderProps {
  project: DesignProject;
  chatLoopActive: boolean;
  hasOpenQuestions: boolean;
  activeTaskId: string | null;
  sending: boolean;
  chatSending: boolean;
  message: string;
  onMessageChange: (message: string) => void;
  onSendProjectPrompt: (prompt: string) => void;
  onFinalizeDesign: () => Promise<void>;
  onOpenProjectFile: (filePath: string) => void;
  onCancelActiveTask: () => Promise<void>;
  onCancelChat: () => void;
  onOpenQuestions: () => void;
}

export function ProjectViewWorkflowHeader({
  project,
  chatLoopActive,
  hasOpenQuestions,
  activeTaskId,
  sending,
  chatSending,
  message,
  onMessageChange,
  onSendProjectPrompt,
  onFinalizeDesign,
  onOpenProjectFile,
  onCancelActiveTask,
  onCancelChat,
  onOpenQuestions,
}: ProjectViewWorkflowHeaderProps) {
  const workflow = useMemo(
    () => deriveDesignCreativeWorkflowState(project),
    [project],
  );
  const effectiveWorkflow = useMemo(() => {
    const primaryAction = designPrimaryAction({
      activeTaskId,
      chatLoopActive,
      chatSending,
      hasOpenQuestions,
      hasOutput: project.outputs.length > 0,
      sending,
      workflowAction: workflow.primaryAction,
      workflowStep: workflow.currentStep,
    });
    return primaryAction === workflow.primaryAction
      ? workflow
      : { ...workflow, primaryAction };
  }, [
    activeTaskId,
    chatLoopActive,
    chatSending,
    hasOpenQuestions,
    project.outputs.length,
    sending,
    workflow,
  ]);

  const runPrimaryAction = () => {
    const action = effectiveWorkflow.primaryAction.id;
    if (action === 'answer-questions') {
      onOpenQuestions();
      return;
    }
    if (action === 'stop-run') {
      if (chatSending) {
        onCancelChat();
        return;
      }
      if (activeTaskId) void onCancelActiveTask();
      return;
    }
    if (action === 'wait-for-run') return;
    if (action === 'send-brief') {
      if (activeTaskId || sending || chatSending) return;
      const prompt =
        message.trim() || String(project.brief.prompt ?? '').trim();
      if (prompt) {
        onSendProjectPrompt(prompt);
        return;
      }
      onMessageChange(project.title);
      return;
    }
    if (action === 'export-output') {
      void onFinalizeDesign();
      return;
    }
    if (action === 'review-output') {
      const outputPath = project.outputs[0]?.path;
      if (outputPath) onOpenProjectFile(outputPath);
      return;
    }
    if (action === 'recover-failure') {
      if (activeTaskId) {
        void onCancelActiveTask();
        return;
      }
      onMessageChange(project.title);
      return;
    }
    if (activeTaskId || sending || chatSending) return;
    const prompt = message.trim() || String(project.brief.prompt ?? '').trim();
    if (prompt) {
      onSendProjectPrompt(prompt);
      return;
    }
    onMessageChange(project.title);
  };

  return (
    <CreativeWorkflowHeader
      workflow={effectiveWorkflow}
      onPrimaryAction={runPrimaryAction}
    />
  );
}

function designPrimaryAction({
  activeTaskId,
  chatLoopActive,
  chatSending,
  hasOpenQuestions,
  hasOutput,
  sending,
  workflowAction,
  workflowStep,
}: {
  activeTaskId: string | null;
  chatLoopActive: boolean;
  chatSending: boolean;
  hasOpenQuestions: boolean;
  hasOutput: boolean;
  sending: boolean;
  workflowAction: CreativeWorkflowAction;
  workflowStep: CreativeWorkflowAction['step'];
}): CreativeWorkflowAction {
  if (activeTaskId || chatSending)
    return { id: 'stop-run', step: workflowStep };
  if (sending) {
    return { id: 'wait-for-run', step: workflowStep, disabled: true };
  }
  if (workflowAction.id === 'recover-failure') return workflowAction;
  if (hasOpenQuestions) return { id: 'answer-questions', step: 'intent' };
  if (chatLoopActive && !hasOutput) return { id: 'send-brief', step: 'intent' };
  return workflowAction;
}
