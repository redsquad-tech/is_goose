import { ActionRequired } from '../api';
import ToolApprovalButtons from './ToolApprovalButtons';

type ToolConfirmationData = Extract<ActionRequired['data'], { actionType: 'toolConfirmation' }>;

interface ToolConfirmationProps {
  sessionId: string;
  isClicked: boolean;
  actionRequiredContent: ActionRequired & { type: 'actionRequired' };
}

export default function ToolConfirmation({
  sessionId,
  isClicked,
  actionRequiredContent,
}: ToolConfirmationProps) {
  const data = actionRequiredContent.data as ToolConfirmationData;
  const { id, toolName, prompt } = data;

  return (
    <div className="goose-message-content bg-background-primary border border-border-primary rounded-2xl overflow-hidden">
      <div className="bg-background-secondary px-4 py-2 text-text-primary">
        {prompt
          ? 'Разрешить этот вызов инструмента?'
          : 'Insightstream хочет вызвать указанный выше инструмент. Разрешить?'}
      </div>
      <ToolApprovalButtons
        data={{ id, toolName, prompt: prompt ?? undefined, sessionId, isClicked }}
      />
    </div>
  );
}
