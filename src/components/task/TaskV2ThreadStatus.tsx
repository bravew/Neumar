import { QuestionInterruptPanel } from '@/components/task/QuestionInterruptPanel';
import { RunErrorBubble } from '@/components/task/RunErrorBubble';
import { RunTreeView } from '@/components/task/RunTreeView';
import {
  SubAgentPanel,
  type SubAgentState,
} from '@/components/task/SubAgentPanel';

interface TaskV2ThreadStatusProps {
  taskId: string | undefined;
  subAgents: SubAgentState[];
  onCancelSubAgent: (id: string) => void;
  runError: string | null;
  errorLabel: string;
  onDismissError: () => void;
}

/** Sub-agents, open questions, and errors: outside the virtualized list. */
export function TaskV2ThreadStatus({
  taskId,
  subAgents,
  onCancelSubAgent,
  runError,
  errorLabel,
  onDismissError,
}: TaskV2ThreadStatusProps) {
  return (
    <>
      {(subAgents.length > 0 || runError) && (
        <div className="mx-auto max-w-4xl px-4">
          {subAgents.length > 0 && (
            <SubAgentPanel subAgents={subAgents} onCancel={onCancelSubAgent} />
          )}

          {/* Persisted run tree (post-stream) — additive to the live SubAgentPanel above. */}
          {taskId && <RunTreeView taskId={taskId} />}

          {runError && (
            <RunErrorBubble
              errorLabel={errorLabel}
              message={runError}
              onDismiss={onDismissError}
            />
          )}
        </div>
      )}
      <QuestionInterruptPanel />
    </>
  );
}
