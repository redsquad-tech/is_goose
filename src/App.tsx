import { useEffect, useState, useRef } from 'react';
import { IpcRendererEvent } from 'electron';
import {
  HashRouter,
  Routes,
  Route,
  useNavigate,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import { ErrorUI } from './components/ErrorBoundary';
import { ToastContainer } from 'react-toastify';
import { createSession } from './sessions';

import { ChatType } from './types/chat';
import Hub from './components/Hub';
import { UserInput } from './types/message';

interface PairRouteState {
  resumeSessionId?: string;
  initialMessage?: UserInput;
}
import SessionsView from './components/sessions/SessionsView';
import { AppLayout } from './components/Layout/AppLayout';
import { ChatProvider, DEFAULT_CHAT_TITLE } from './contexts/ChatContext';

import 'react-toastify/dist/ReactToastify.css';
import { ThemeProvider } from './contexts/ThemeContext';
import { View } from './utils/navigationUtils';

import { useNavigation } from './hooks/useNavigation';
import { trackErrorWithContext } from './utils/analytics';
import { errorMessage } from './utils/conversionUtils';
import { getInitialWorkingDir } from './utils/workingDir';
import { AppEvents } from './constants/events';
import { ConfigProvider, useConfig } from './components/ConfigContext';
import InsightStreamOnboarding from './components/InsightStreamOnboarding';

// Route Components
const HubRouteWrapper = () => {
  const setView = useNavigation();
  return <Hub setView={setView} />;
};

const PairRouteWrapper = ({
  activeSessions,
}: {
  activeSessions: Array<{
    sessionId: string;
    initialMessage?: UserInput;
  }>;
  setActiveSessions: (sessions: Array<{ sessionId: string; initialMessage?: UserInput }>) => void;
}) => {
  const location = useLocation();
  const routeState =
    (location.state as PairRouteState) || (window.history.state as PairRouteState) || {};
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const resumeSessionId = searchParams.get('resumeSessionId') ?? undefined;
  const initialMessage = routeState.initialMessage;

  // Create session if we have an initialMessage but no sessionId
  useEffect(() => {
    if (initialMessage && !resumeSessionId && !isCreatingSession) {
      setIsCreatingSession(true);

      (async () => {
        try {
          const newSession = await createSession(getInitialWorkingDir());

          window.dispatchEvent(
            new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
              detail: {
                sessionId: newSession.id,
                initialMessage,
              },
            })
          );

          setSearchParams((prev) => {
            prev.set('resumeSessionId', newSession.id);
            return prev;
          });
        } catch (error) {
          console.error('Failed to create session:', error);
          trackErrorWithContext(error, {
            component: 'PairRouteWrapper',
            action: 'create_session',
            recoverable: true,
          });
        } finally {
          setIsCreatingSession(false);
        }
      })();
    }
    // Note: isCreatingSession is intentionally NOT in the dependency array
    // It's only used as a guard to prevent concurrent session creation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialMessage,
    resumeSessionId,
    setSearchParams,
  ]);

  // Add resumed session to active sessions if not already there
  useEffect(() => {
    if (resumeSessionId && !activeSessions.some((s) => s.sessionId === resumeSessionId)) {
      window.dispatchEvent(
        new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
          detail: {
            sessionId: resumeSessionId,
            initialMessage: initialMessage,
          },
        })
      );
    }
  }, [resumeSessionId, activeSessions, initialMessage]);

  return null;
};

const SessionsRoute = () => {
  return <SessionsView />;
};

const AppRoutes = ({
  chat,
  setChat,
  activeSessions,
  setActiveSessions,
}: {
  chat: ChatType;
  setChat: React.Dispatch<React.SetStateAction<ChatType>>;
  activeSessions: Array<{ sessionId: string; initialMessage?: UserInput }>;
  setActiveSessions: React.Dispatch<
    React.SetStateAction<Array<{ sessionId: string; initialMessage?: UserInput }>>
  >;
}) => {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ChatProvider chat={chat} setChat={setChat} contextKey="hub">
            <AppLayout activeSessions={activeSessions} />
          </ChatProvider>
        }
      >
        <Route index element={<HubRouteWrapper />} />
        <Route
          path="pair"
          element={
            <PairRouteWrapper
              activeSessions={activeSessions}
              setActiveSessions={setActiveSessions}
            />
          }
        />
        <Route path="sessions" element={<SessionsRoute />} />
      </Route>
    </Routes>
  );
};

export function AppInner() {
  const [fatalError, setFatalError] = useState<string | null>(null);
  const { read } = useConfig();
  const [isCheckingProvider, setIsCheckingProvider] = useState(true);
  const [isProviderConfigured, setIsProviderConfigured] = useState(false);

  const navigate = useNavigate();

  const [chat, setChat] = useState<ChatType>({
    sessionId: '',
    name: DEFAULT_CHAT_TITLE,
    messages: [],
  });

  const MAX_ACTIVE_SESSIONS = 10;

  const [activeSessions, setActiveSessions] = useState<
    Array<{ sessionId: string; initialMessage?: UserInput }>
  >([]);

  useEffect(() => {
    const handleAddActiveSession = (event: Event) => {
      const { sessionId, initialMessage } = (
        event as CustomEvent<{
          sessionId: string;
          initialMessage?: UserInput;
        }>
      ).detail;

      setActiveSessions((prev) => {
        const existingIndex = prev.findIndex((s) => s.sessionId === sessionId);

        if (existingIndex !== -1) {
          // Session exists - move to end of LRU list (most recently used)
          const existing = prev[existingIndex];
          return [...prev.slice(0, existingIndex), ...prev.slice(existingIndex + 1), existing];
        }

        // New session - add to end with LRU eviction if needed
        const newSession = { sessionId, initialMessage };
        const updated = [...prev, newSession];
        if (updated.length > MAX_ACTIVE_SESSIONS) {
          return updated.slice(updated.length - MAX_ACTIVE_SESSIONS);
        }
        return updated;
      });
    };

    const handleClearInitialMessage = (event: Event) => {
      const { sessionId } = (event as CustomEvent<{ sessionId: string }>).detail;

      setActiveSessions((prev) => {
        return prev.map((session) => {
          if (session.sessionId === sessionId) {
            return { ...session, initialMessage: undefined };
          }
          return session;
        });
      });
    };

    window.addEventListener(AppEvents.ADD_ACTIVE_SESSION, handleAddActiveSession);
    window.addEventListener(AppEvents.CLEAR_INITIAL_MESSAGE, handleClearInitialMessage);
    return () => {
      window.removeEventListener(AppEvents.ADD_ACTIVE_SESSION, handleAddActiveSession);
      window.removeEventListener(AppEvents.CLEAR_INITIAL_MESSAGE, handleClearInitialMessage);
    };
  }, []);

  useEffect(() => {
    const checkProvider = async () => {
      try {
        const provider = await read('GOOSE_PROVIDER', false);
        const apiKey = await read('OPENAI_API_KEY', true);

        const hasProvider = typeof provider === 'string' && provider.trim().length > 0;
        const hasApiKey = apiKey !== null;

        setIsProviderConfigured(hasProvider && hasApiKey);
      } catch (error) {
        console.error('Failed to check provider configuration:', error);
        setIsProviderConfigured(false);
      } finally {
        setIsCheckingProvider(false);
      }
    };

    void checkProvider();
  }, [read]);

  useEffect(() => {
    console.log('Sending reactReady signal to Electron');
    try {
      window.electron.reactReady();
    } catch (error) {
      console.error('Error sending reactReady:', error);
      setFatalError(`React ready notification failed: ${errorMessage(error, 'Unknown error')}`);
    }
  }, []);

  // Prevent default drag and drop behavior globally to avoid opening files in new windows
  // but allow our React components to handle drops in designated areas
  useEffect(() => {
    const preventDefaults = (e: globalThis.DragEvent) => {
      // Only prevent default if we're not over a designated drop zone
      const target = e.target as HTMLElement;
      const isOverDropZone = target.closest('[data-drop-zone="true"]') !== null;

      if (!isOverDropZone) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleDragOver = (e: globalThis.DragEvent) => {
      // Always prevent default for dragover to allow dropping
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: globalThis.DragEvent) => {
      // Only prevent default if we're not over a designated drop zone
      const target = e.target as HTMLElement;
      const isOverDropZone = target.closest('[data-drop-zone="true"]') !== null;

      if (!isOverDropZone) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Add event listeners to document to catch drag events
    document.addEventListener('dragenter', preventDefaults, false);
    document.addEventListener('dragleave', preventDefaults, false);
    document.addEventListener('dragover', handleDragOver, false);
    document.addEventListener('drop', handleDrop, false);

    return () => {
      document.removeEventListener('dragenter', preventDefaults, false);
      document.removeEventListener('dragleave', preventDefaults, false);
      document.removeEventListener('dragover', handleDragOver, false);
      document.removeEventListener('drop', handleDrop, false);
    };
  }, []);

  useEffect(() => {
    const handleFatalError = (_event: IpcRendererEvent, ...args: unknown[]) => {
      const errorMessage = args[0] as string;
      console.error('Encountered a fatal error:', errorMessage);
      setFatalError(errorMessage);
    };
    window.electron.on('fatal-error', handleFatalError);
    return () => {
      window.electron.off('fatal-error', handleFatalError);
    };
  }, []);

  useEffect(() => {
    const handleSetView = (_event: IpcRendererEvent, ...args: unknown[]) => {
      const newView = args[0] as View;
      const section = args[1] as string | undefined;
      console.log(
        `Received view change request to: ${newView}${section ? `, section: ${section}` : ''}`
      );
      void section;
      navigate(`/${newView}`);
    };

    window.electron.on('set-view', handleSetView);
    return () => window.electron.off('set-view', handleSetView);
  }, [navigate]);

  useEffect(() => {
    const handleNewChat = (_event: IpcRendererEvent, ..._args: unknown[]) => {
      console.log('Received new-chat event from keyboard shortcut');
      window.dispatchEvent(new CustomEvent(AppEvents.TRIGGER_NEW_CHAT));
    };

    window.electron.on('new-chat', handleNewChat);
    return () => window.electron.off('new-chat', handleNewChat);
  }, []);

  useEffect(() => {
    const handleFocusInput = (_event: IpcRendererEvent, ..._args: unknown[]) => {
      const inputField = document.querySelector('input[type="text"], textarea') as HTMLInputElement;
      if (inputField) {
        inputField.focus();
      }
    };
    window.electron.on('focus-input', handleFocusInput);
    return () => {
      window.electron.off('focus-input', handleFocusInput);
    };
  }, []);

  // Handle an initial message pushed in from the main process
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const handleSetInitialMessage = async (_event: IpcRendererEvent, ...args: unknown[]) => {
      const initialMessage = args[0] as string;
      console.log(
        '[App] Received set-initial-message event:',
        initialMessage,
        'isProcessing:',
        isProcessingRef.current
      );

      if (initialMessage && !isProcessingRef.current) {
        isProcessingRef.current = true;
        console.log('[App] Processing initial message:', initialMessage);
        navigate('/pair', {
          state: {
            initialMessage: { msg: initialMessage, images: [] },
          },
        });
        setTimeout(() => {
          isProcessingRef.current = false;
        }, 1000);
      } else if (initialMessage) {
        console.log('[App] Ignoring duplicate initial message (already processing)');
      }
    };
    window.electron.on('set-initial-message', handleSetInitialMessage);
    return () => {
      window.electron.off('set-initial-message', handleSetInitialMessage);
    };
  }, [navigate]);

  if (fatalError) {
    return <ErrorUI error={errorMessage(fatalError)} />;
  }

  return (
    <>
      <ToastContainer
        aria-label="Toast notifications"
        toastClassName={() =>
          `relative min-h-16 mb-4 p-2 rounded-lg
               flex justify-between overflow-hidden cursor-pointer
               text-text-inverse bg-background-inverse
              `
        }
        style={{ width: '450px' }}
        className="mt-6"
        position="top-right"
        autoClose={3000}
        closeOnClick
        pauseOnHover
      />
      <div className="relative w-screen h-screen overflow-hidden bg-background-secondary flex flex-col">
        <div className="titlebar-drag-region" />
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {isCheckingProvider ? (
            <div className="h-full w-full flex items-center justify-center text-text-secondary">
              Проверяем настройки...
            </div>
          ) : isProviderConfigured ? (
            <AppRoutes
              chat={chat}
              setChat={setChat}
              activeSessions={activeSessions}
              setActiveSessions={setActiveSessions}
            />
          ) : (
            <InsightStreamOnboarding onConfigured={() => setIsProviderConfigured(true)} />
          )}
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ConfigProvider>
        <HashRouter>
          <AppInner />
        </HashRouter>
      </ConfigProvider>
    </ThemeProvider>
  );
}
