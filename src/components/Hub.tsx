import { useState } from 'react';
import { AppEvents } from '../constants/events';
import ChatInput from './ChatInput';
import { ChatState } from '../types/chatState';
import 'react-toastify/dist/ReactToastify.css';
import { View, ViewOptions } from '../utils/navigationUtils';
import { getInitialWorkingDir } from '../utils/workingDir';
import { createSession } from '../sessions';
import LoadingGoose from './LoadingGoose';
import { UserInput } from '../types/message';
import { MainPanelLayout } from './Layout/MainPanelLayout';
import { ScrollArea } from './ui/scroll-area';
import PopularChatTopics from './PopularChatTopics';

export default function Hub({
  setView,
}: {
  setView: (view: View, viewOptions?: ViewOptions) => void;
}) {
  const [workingDir, setWorkingDir] = useState(getInitialWorkingDir());
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const handleSubmit = async (input: UserInput) => {
    const { msg: userMessage, images } = input;
    if ((images.length > 0 || userMessage.trim()) && !isCreatingSession) {
      setIsCreatingSession(true);

      try {
        const session = await createSession(workingDir);

        window.dispatchEvent(new CustomEvent(AppEvents.SESSION_CREATED));
        window.dispatchEvent(
          new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
            detail: { sessionId: session.id, initialMessage: { msg: userMessage, images } },
          })
        );

        setView('pair', {
          disableAnimation: true,
          resumeSessionId: session.id,
          initialMessage: { msg: userMessage, images },
        });
      } catch (error) {
        console.error('Failed to create session:', error);
        setIsCreatingSession(false);
      }
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <MainPanelLayout backgroundColor="bg-background-secondary" removeTopPadding>
        <div className="flex flex-col flex-1 mb-0.5 min-h-0 relative">
          <ScrollArea
            className="flex-1 bg-background-primary rounded-b-2xl min-h-0 relative pr-1 pb-10 pt-10"
            paddingX={6}
            paddingY={0}
          >
            <PopularChatTopics
              append={(text: string) => void handleSubmit({ msg: text, images: [] })}
            />
          </ScrollArea>

          {isCreatingSession && (
            <div className="absolute bottom-1 left-4 z-20 pointer-events-none">
              <LoadingGoose chatState={ChatState.LoadingConversation} />
            </div>
          )}
        </div>

        <div className="relative z-10">
          <ChatInput
            sessionId={null}
            handleSubmit={handleSubmit}
            chatState={isCreatingSession ? ChatState.LoadingConversation : ChatState.Idle}
            onStop={() => {}}
            initialValue=""
            totalTokens={0}
            droppedFiles={[]}
            onFilesProcessed={() => {}}
            messages={[]}
            disableAnimation={false}
            toolCount={0}
            onWorkingDirChange={setWorkingDir}
          />
        </div>
      </MainPanelLayout>
    </div>
  );
}
