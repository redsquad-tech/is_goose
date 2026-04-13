import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { FolderDot, ScrollText } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip';
import { Button } from './ui/button';
import Stop from './ui/Stop';
import { Attach, Send, Close } from './icons';
import { ChatState } from '../types/chatState';
import debounce from 'lodash/debounce';
import { LocalMessageStorage } from '../utils/localMessageStorage';
import { AlertType, useAlerts } from './alerts';
import MentionPopover, { DisplayItemWithMatch } from './MentionPopover';
import { DroppedFile, useFileDrop } from '../hooks/useFileDrop';
import { MessageQueue, QueuedMessage } from './MessageQueue';
import { detectInterruption } from '../utils/interruptionDetector';
import { getSession, Message } from '../api';
import { getInitialWorkingDir } from '../utils/workingDir';
import { UserInput, ImageData } from '../types/message';

// Constants for token and tool alerts
const TOKEN_LIMIT_DEFAULT = 128000; // fallback for custom models that the backend doesn't know about
const TOOLS_MAX_SUGGESTED = 60; // max number of tools before we show a warning
const EVENT_HIDE_ALERT_POPOVER = 'hide-alert-popover';

// Manual compact trigger message - must match backend constant
const MANUAL_COMPACT_TRIGGER = '/compact';

interface ChatInputProps {
  sessionId: string | null;
  handleSubmit: (input: UserInput) => void;
  chatState: ChatState;
  setChatState?: (state: ChatState) => void;
  onStop?: () => void;
  commandHistory?: string[];
  initialValue?: string;
  droppedFiles?: DroppedFile[];
  onFilesProcessed?: () => void;
  totalTokens?: number;
  messages?: Message[];
  disableAnimation?: boolean;
  toolCount: number;
  append?: (message: Message) => void;
  onWorkingDirChange?: (newDir: string) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export default function ChatInput({
  sessionId,
  handleSubmit,
  chatState = ChatState.Idle,
  onStop,
  commandHistory = [],
  initialValue = '',
  droppedFiles = [],
  onFilesProcessed,
  totalTokens,
  messages: _messages = [],
  disableAnimation = false,
  toolCount,
  append: _append,
  inputRef,
}: ChatInputProps) {
  const [_value, setValue] = useState(initialValue);
  const [displayValue, setDisplayValue] = useState(initialValue); // For immediate visual feedback
  const [isFocused, setIsFocused] = useState(false);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);

  // Derived state - chatState != Idle means we're in some form of loading state
  const isLoading = chatState !== ChatState.Idle;
  const wasLoadingRef = useRef(isLoading);

  // Queue functionality - ephemeral, only exists in memory for this chat instance
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const queuePausedRef = useRef(false);
  const editingMessageIdRef = useRef<string | null>(null);
  const [lastInterruption, setLastInterruption] = useState<string | null>(null);

  const { addAlert, clearAlerts } = useAlerts();
  const [tokenLimit] = useState<number>(TOKEN_LIMIT_DEFAULT);
  const [sessionWorkingDir, setSessionWorkingDir] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const fetchSessionWorkingDir = async () => {
      try {
        const response = await getSession({ path: { session_id: sessionId } });
        if (response.data?.working_dir) {
          setSessionWorkingDir(response.data.working_dir);
        }
      } catch (error) {
        console.error('[ChatInput] Failed to fetch session working dir:', error);
      }
    };

    fetchSessionWorkingDir();
  }, [sessionId]);

  // Save queue state (paused/interrupted) to storage
  useEffect(() => {
    try {
      window.sessionStorage.setItem('goose-queue-paused', JSON.stringify(queuePausedRef.current));
    } catch (error) {
      console.error('Error saving queue pause state:', error);
    }
  }, [queuedMessages]); // Save when queue changes

  useEffect(() => {
    try {
      window.sessionStorage.setItem('goose-queue-interruption', JSON.stringify(lastInterruption));
    } catch (error) {
      console.error('Error saving queue interruption state:', error);
    }
  }, [lastInterruption]);

  // Cleanup effect - save final state on component unmount
  useEffect(() => {
    return () => {
      // Save final queue state when component unmounts
      try {
        window.sessionStorage.setItem('goose-queue-paused', JSON.stringify(queuePausedRef.current));
        window.sessionStorage.setItem('goose-queue-interruption', JSON.stringify(lastInterruption));
      } catch (error) {
        console.error('Error saving queue state on unmount:', error);
      }
    };
  }, [lastInterruption]); // Include lastInterruption in dependency array

  // Queue processing
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && queuedMessages.length > 0) {
      // After an interruption, we should process the interruption message immediately
      // The queue is only truly paused if there was an interruption AND we want to keep it paused
      const shouldProcessQueue = !queuePausedRef.current || lastInterruption;

      if (shouldProcessQueue) {
        const nextMessage = queuedMessages[0];
        LocalMessageStorage.addMessage(nextMessage.content);
        handleSubmit({ msg: nextMessage.content, images: nextMessage.images });
        setQueuedMessages((prev) => {
          const newQueue = prev.slice(1);
          // If queue becomes empty after processing, clear the paused state
          if (newQueue.length === 0) {
            queuePausedRef.current = false;
            setLastInterruption(null);
          }
          return newQueue;
        });

        // Clear the interruption flag after processing the interruption message
        if (lastInterruption) {
          setLastInterruption(null);
          // Keep the queue paused after sending the interruption message
          // User can manually resume if they want to continue with queued messages
          queuePausedRef.current = true;
        }
      }
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, queuedMessages, handleSubmit, lastInterruption]);
  const [mentionPopover, setMentionPopover] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    query: string;
    mentionStart: number;
    selectedIndex: number;
    isSlashCommand: boolean;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    query: '',
    mentionStart: -1,
    selectedIndex: 0,
    isSlashCommand: false,
  });
  const mentionPopoverRef = useRef<{
    getDisplayFiles: () => DisplayItemWithMatch[];
    selectFile: (index: number) => void;
  }>(null);

  const internalTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const textAreaRef = inputRef || internalTextAreaRef;

  useEffect(() => {
    setValue(initialValue);
    setDisplayValue(initialValue);
    setHistoryIndex(-1);
    setIsInGlobalHistory(false);
    setHasUserTyped(false);
  }, [initialValue]);

  const [isComposing, setIsComposing] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState('');
  const [isInGlobalHistory, setIsInGlobalHistory] = useState(false);
  const [hasUserTyped, setHasUserTyped] = useState(false);

  // Use shared file drop hook for ChatInput
  const {
    droppedFiles: localDroppedFiles,
    setDroppedFiles: setLocalDroppedFiles,
    handleDrop: handleLocalDrop,
    handleDragOver: handleLocalDragOver,
  } = useFileDrop();

  // Merge local dropped files with parent dropped files
  const allDroppedFiles = useMemo(
    () => [...droppedFiles, ...localDroppedFiles],
    [droppedFiles, localDroppedFiles]
  );

  const handleRemoveDroppedFile = (idToRemove: string) => {
    // Remove from local dropped files
    setLocalDroppedFiles((prev) => prev.filter((file) => file.id !== idToRemove));

    // If it's from parent, call the parent's callback
    if (onFilesProcessed && droppedFiles.some((file) => file.id === idToRemove)) {
      onFilesProcessed();
    }
  };

  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [textAreaRef]);

  // Handle tool count alerts and token usage
  useEffect(() => {
    clearAlerts();

    if ((totalTokens && totalTokens > 0) || tokenLimit) {
      addAlert({
        type: AlertType.Info,
        message: 'Context window',
        progress: {
          current: totalTokens || 0,
          total: tokenLimit,
        },
        showCompactButton: true,
        compactButtonDisabled: !totalTokens,
        onCompact: () => {
          window.dispatchEvent(new CustomEvent(EVENT_HIDE_ALERT_POPOVER));
          handleSubmit({ msg: MANUAL_COMPACT_TRIGGER, images: [] });
        },
        compactIcon: <ScrollText size={12} />,
      });
    }

    // Add tool count alert if we have the data
    if (toolCount !== null && toolCount > TOOLS_MAX_SUGGESTED) {
      addAlert({
        type: AlertType.Warning,
        message: `Too many tools can degrade performance.\nTool count: ${toolCount} (recommend: ${TOOLS_MAX_SUGGESTED})`,
        autoShow: false, // Don't auto-show tool count warnings
      });
    }
    // We intentionally omit setView as it shouldn't trigger a re-render of alerts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalTokens, toolCount, tokenLimit, addAlert, clearAlerts]);

  // Cleanup effect for component unmount - prevent memory leaks
  useEffect(() => {
    return () => {
      // Clear alerts to prevent memory leaks
      clearAlerts();
    };
  }, [clearAlerts]);

  const maxHeight = 10 * 24;

  // Immediate function to update actual value - no debounce for better responsiveness
  const updateValue = React.useCallback((value: string) => {
    setValue(value);
  }, []);

  const minTextareaHeight = 38;

  const debouncedAutosize = useMemo(
    () =>
      debounce((element: HTMLTextAreaElement) => {
        // Store current scroll position to prevent jump
        const scrollTop = element.scrollTop;

        // Temporarily set to auto to measure natural height, but use minHeight to prevent collapse
        element.style.height = `${minTextareaHeight}px`;
        const scrollHeight = element.scrollHeight;
        const newHeight = Math.max(minTextareaHeight, Math.min(scrollHeight, maxHeight));
        element.style.height = `${newHeight}px`;

        // Restore scroll position
        element.scrollTop = scrollTop;
      }, 50),
    [maxHeight, minTextareaHeight]
  );

  useEffect(() => {
    if (textAreaRef.current) {
      debouncedAutosize(textAreaRef.current);
    }
  }, [debouncedAutosize, displayValue, textAreaRef]);

  // Set consistent minimum height when displayValue is empty
  useEffect(() => {
    if (textAreaRef.current && displayValue === '') {
      textAreaRef.current.style.height = `${minTextareaHeight}px`;
    }
  }, [displayValue, textAreaRef, minTextareaHeight]);

  const handleChange = (evt: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = evt.target.value;
    const cursorPosition = evt.target.selectionStart;

    setDisplayValue(val);
    updateValue(val);
    setHasUserTyped(true);
    checkForMentionOrSlash(val, cursorPosition, evt.target);
  };

  const checkForMentionOrSlash = (
    text: string,
    cursorPosition: number,
    textArea: HTMLTextAreaElement
  ) => {
    const isSlashCommand = text.startsWith('/');
    const beforeCursor = text.slice(0, cursorPosition);
    const lastAtIndex = isSlashCommand ? 0 : beforeCursor.lastIndexOf('@');

    if (lastAtIndex === -1) {
      // No @ found, close mention popover
      setMentionPopover((prev) => ({ ...prev, isOpen: false }));
      return;
    }

    // Check if there's a space between @ and cursor (which would end the mention)
    const afterAt = beforeCursor.slice(lastAtIndex + 1);
    if (afterAt.includes(' ') || afterAt.includes('\n')) {
      setMentionPopover((prev) => ({ ...prev, isOpen: false }));
      return;
    }

    // Calculate position for the popover - position it above the chat input
    const textAreaRect = textArea.getBoundingClientRect();

    setMentionPopover((prev) => ({
      ...prev,
      isOpen: true,
      position: {
        x: textAreaRect.left,
        y: textAreaRect.top, // Position at the top of the textarea
      },
      query: afterAt,
      mentionStart: lastAtIndex,
      selectedIndex: 0, // Reset selection when query changes
      isSlashCommand,
      // filteredFiles will be populated by the MentionPopover component
    }));
  };

  const convertImagesToImageData = useCallback((): ImageData[] => {
    return [];
  }, []);

  const appendDroppedFilePaths = useCallback(
    (text: string): string => {
      const droppedFilePaths = allDroppedFiles
        .filter((file) => !file.isImage && !file.error && !file.isLoading)
        .map((file) => file.path);

      if (droppedFilePaths.length > 0) {
        const pathsString = droppedFilePaths.join(' ');
        return text ? `${text} ${pathsString}` : pathsString;
      }
      return text;
    },
    [allDroppedFiles]
  );

  const clearInputState = useCallback(() => {
    setDisplayValue('');
    setValue('');
    if (onFilesProcessed && droppedFiles.length > 0) {
      onFilesProcessed();
    }
    if (localDroppedFiles.length > 0) {
      setLocalDroppedFiles([]);
    }
  }, [droppedFiles.length, localDroppedFiles.length, onFilesProcessed, setLocalDroppedFiles]);

  const handlePaste = async (evt: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(evt.clipboardData.files || []);
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));

    if (imageFiles.length === 0) return;

    evt.preventDefault();
    const imagePlaceholders = imageFiles.map((file, index) => ({
      id: `paste-image-disabled-${Date.now()}-${index}`,
      path: '',
      name: file.name || `image-${index + 1}`,
      type: file.type || 'image/*',
      isImage: false,
      isLoading: false,
      error: 'Загрузка изображений временно отключена',
    }));
    setLocalDroppedFiles((prev) => [...prev, ...imagePlaceholders]);
  };

  // Cleanup debounced functions on unmount
  useEffect(() => {
    return () => {
      debouncedAutosize.cancel?.();
    };
  }, [debouncedAutosize]);

  // Handlers for composition events, which are crucial for proper IME behavior
  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setIsComposing(false);
  };

  const handleHistoryNavigation = (evt: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isUp = evt.key === 'ArrowUp';
    const isDown = evt.key === 'ArrowDown';

    // Only handle up/down keys with Cmd/Ctrl modifier
    if ((!isUp && !isDown) || !(evt.metaKey || evt.ctrlKey) || evt.altKey || evt.shiftKey) {
      return;
    }

    // Only prevent history navigation if the user has actively typed something
    // This allows history navigation when text is populated from history or other sources
    // but prevents it when the user is actively editing text
    if (hasUserTyped && displayValue.trim() !== '') {
      return;
    }

    evt.preventDefault();

    // Get global history once to avoid multiple calls
    const globalHistory = LocalMessageStorage.getRecentMessages() || [];

    // Save current input if we're just starting to navigate history
    if (historyIndex === -1) {
      setSavedInput(displayValue || '');
      setIsInGlobalHistory(commandHistory.length === 0);
    }

    // Determine which history we're using
    const currentHistory = isInGlobalHistory ? globalHistory : commandHistory;
    let newIndex = historyIndex;
    let newValue = '';

    // Handle navigation
    if (isUp) {
      // Moving up through history
      if (newIndex < currentHistory.length - 1) {
        // Still have items in current history
        newIndex = historyIndex + 1;
        newValue = currentHistory[newIndex];
      } else if (!isInGlobalHistory && globalHistory.length > 0) {
        // Switch to global history
        setIsInGlobalHistory(true);
        newIndex = 0;
        newValue = globalHistory[newIndex];
      }
    } else {
      // Moving down through history
      if (newIndex > 0) {
        // Still have items in current history
        newIndex = historyIndex - 1;
        newValue = currentHistory[newIndex];
      } else if (isInGlobalHistory && commandHistory.length > 0) {
        // Switch to chat history
        setIsInGlobalHistory(false);
        newIndex = commandHistory.length - 1;
        newValue = commandHistory[newIndex];
      } else {
        // Return to original input
        newIndex = -1;
        newValue = savedInput;
      }
    }

    // Update display if we have a new value
    if (newIndex !== historyIndex) {
      setHistoryIndex(newIndex);
      if (newIndex === -1) {
        setDisplayValue(savedInput || '');
        setValue(savedInput || '');
      } else {
        setDisplayValue(newValue || '');
        setValue(newValue || '');
      }
      // Reset hasUserTyped when we populate from history
      setHasUserTyped(false);
    }
  };

  const handleInterruptionAndQueue = () => {
    if (!isLoading || !hasSubmittableContent) {
      return false;
    }

    const imageData = convertImagesToImageData();
    const contentToQueue = appendDroppedFilePaths(displayValue.trim());

    const interruptionMatch = detectInterruption(displayValue.trim());

    if (interruptionMatch && interruptionMatch.shouldInterrupt) {
      setLastInterruption(interruptionMatch.matchedText);
      if (onStop) onStop();
      queuePausedRef.current = true;

      // For interruptions, we need to queue the message to be sent after the stop completes
      // rather than trying to send it immediately while the system is still loading
      const interruptionMessage: QueuedMessage = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        content: contentToQueue,
        timestamp: Date.now(),
        images: imageData,
      };

      // Add the interruption message to the front of the queue so it gets sent first
      setQueuedMessages((prev) => [interruptionMessage, ...prev]);

      clearInputState();
      return true;
    }

    const newMessage: QueuedMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      content: contentToQueue,
      timestamp: Date.now(),
      images: imageData,
    };
    setQueuedMessages((prev) => {
      const newQueue = [...prev, newMessage];
      // If adding to an empty queue, reset the paused state
      if (prev.length === 0) {
        queuePausedRef.current = false;
        setLastInterruption(null);
      }
      return newQueue;
    });
    clearInputState();
    return true;
  };

  const canSubmit =
    !isLoading &&
    (displayValue.trim() || allDroppedFiles.some((file) => !file.error && !file.isLoading));

  const performSubmit = useCallback(
    (text?: string) => {
      const imageData = convertImagesToImageData();
      const textToSend = appendDroppedFilePaths(text ?? displayValue.trim());

      if (textToSend || imageData.length > 0) {
        // Store original message in history
        if (displayValue.trim()) {
          LocalMessageStorage.addMessage(displayValue);
        } else {
          const droppedFilePaths = allDroppedFiles
            .filter((file) => !file.isImage && !file.error && !file.isLoading)
            .map((file) => file.path);
          if (droppedFilePaths.length > 0) {
            LocalMessageStorage.addMessage(droppedFilePaths.join(' '));
          }
        }

        handleSubmit({ msg: textToSend, images: imageData });

        // Auto-resume queue after sending a NON-interruption message (if it was paused due to interruption)
        if (
          queuePausedRef.current &&
          lastInterruption &&
          textToSend &&
          !detectInterruption(textToSend)
        ) {
          queuePausedRef.current = false;
          setLastInterruption(null);
        }

        clearInputState();
        setHistoryIndex(-1);
        setSavedInput('');
        setIsInGlobalHistory(false);
        setHasUserTyped(false);
      }
    },
    [
      convertImagesToImageData,
      appendDroppedFilePaths,
      displayValue,
      allDroppedFiles,
      handleSubmit,
      lastInterruption,
      clearInputState,
    ]
  );

  const handleKeyDown = (evt: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionPopover.isOpen && mentionPopoverRef.current) {
      if (evt.key === 'ArrowDown') {
        evt.preventDefault();
        const displayFiles = mentionPopoverRef.current.getDisplayFiles();
        const maxIndex = Math.max(0, displayFiles.length - 1);
        setMentionPopover((prev) => ({
          ...prev,
          selectedIndex: Math.min(prev.selectedIndex + 1, maxIndex),
        }));
        return;
      }
      if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        setMentionPopover((prev) => ({
          ...prev,
          selectedIndex: Math.max(prev.selectedIndex - 1, 0),
        }));
        return;
      }
      if (evt.key === 'Enter') {
        evt.preventDefault();
        mentionPopoverRef.current.selectFile(mentionPopover.selectedIndex);
        return;
      }
      if (evt.key === 'Escape') {
        evt.preventDefault();
        setMentionPopover((prev) => ({ ...prev, isOpen: false }));
        return;
      }
    }

    handleHistoryNavigation(evt);

    if (evt.key === 'Enter') {
      // should not trigger submit on Enter if it's composing (IME input in progress) or shift/alt(option) is pressed
      if (evt.shiftKey || isComposing) {
        // Allow line break for Shift+Enter, or during IME composition
        return;
      }

      if (evt.altKey) {
        const newValue = displayValue + '\n';
        setDisplayValue(newValue);
        setValue(newValue);
        return;
      }

      evt.preventDefault();

      // Handle interruption and queue logic
      if (handleInterruptionAndQueue()) {
        return;
      }

      if (canSubmit) {
        performSubmit();
      }
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading && hasSubmittableContent) {
      handleInterruptionAndQueue();
      return;
    }
    const canSubmit =
      !isLoading &&
      (displayValue.trim() || allDroppedFiles.some((file) => !file.error && !file.isLoading));
    if (canSubmit) {
      performSubmit();
    }
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = () => {
    if (isFilePickerOpen) return;
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsFilePickerOpen(true);
    const file = files[0];
    const isImage = file.type.startsWith('image/');

    if (isImage) {
      setLocalDroppedFiles((prev) => [
        ...prev,
        {
          id: `attach-image-disabled-${Date.now()}`,
          path: '',
          name: file.name,
          type: file.type,
          isImage: false,
          isLoading: false,
          error: 'Загрузка изображений временно отключена',
        },
      ]);
    } else {
      const fromBridge = window.electron.getPathForFile(file);
      const path =
        (typeof fromBridge === 'string' && fromBridge.trim().length > 0
          ? fromBridge
          : (file as File & { path?: string }).path) || '';
      if (!path.trim()) {
        setLocalDroppedFiles((prev) => [
          ...prev,
          {
            id: `attach-file-error-${Date.now()}`,
            path: '',
            name: file.name,
            type: file.type,
            isImage: false,
            isLoading: false,
            error: 'Не удалось получить путь к файлу',
          },
        ]);
        setIsFilePickerOpen(false);
        if (e.target) {
          e.target.value = '';
        }
        return;
      }
      setLocalDroppedFiles((prev) => [
        ...prev,
        {
          id: `attach-file-${Date.now()}`,
          path,
          name: file.name,
          type: file.type,
          isImage: false,
          isLoading: false,
        },
      ]);
    }

    textAreaRef.current?.focus();
    setIsFilePickerOpen(false);
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleMentionItemSelect = (itemText: string) => {
    // Replace the @ mention with the file path
    const beforeMention = displayValue.slice(0, mentionPopover.mentionStart);
    const afterMention = displayValue.slice(
      mentionPopover.mentionStart + 1 + mentionPopover.query.length
    );
    const newValue = `${beforeMention}${itemText}${afterMention}`;

    setDisplayValue(newValue);
    setValue(newValue);
    setMentionPopover((prev) => ({ ...prev, isOpen: false }));
    textAreaRef.current?.focus();

    // Set cursor position after the inserted file path
    setTimeout(() => {
      if (textAreaRef.current) {
        const newCursorPosition = beforeMention.length + itemText.length;
        textAreaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
      }
    }, 0);
  };

  const hasSubmittableContent =
    displayValue.trim() || allDroppedFiles.some((file) => !file.error && !file.isLoading);
  const isAnyImageLoading = false;
  const isAnyDroppedFileLoading = allDroppedFiles.some((file) => file.isLoading);

  const isSubmitButtonDisabled =
    !hasSubmittableContent ||
    isAnyImageLoading ||
    isAnyDroppedFileLoading ||
    chatState === ChatState.RestartingAgent;

  const getSubmitButtonTooltip = (): string => {
    if (isAnyImageLoading) return 'Ожидаем сохранения изображений...';
    if (isAnyDroppedFileLoading) return 'Обрабатываем добавленные файлы...';
    if (chatState === ChatState.RestartingAgent) return 'Перезапускаем сессию...';
    if (!hasSubmittableContent) return 'Введите сообщение для отправки';
    return 'Отправить';
  };

  // Queue management functions - no storage persistence, only in-memory
  const handleRemoveQueuedMessage = (messageId: string) => {
    setQueuedMessages((prev) => prev.filter((msg) => msg.id !== messageId));
  };

  const handleClearQueue = () => {
    setQueuedMessages([]);
    queuePausedRef.current = false;
    setLastInterruption(null);
  };

  const handleReorderMessages = (reorderedMessages: QueuedMessage[]) => {
    setQueuedMessages(reorderedMessages);
  };

  const handleEditMessage = (messageId: string, newContent: string) => {
    setQueuedMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, content: newContent } : msg))
    );
  };

  const handleStopAndSend = (messageId: string) => {
    const messageToSend = queuedMessages.find((msg) => msg.id === messageId);
    if (!messageToSend) return;

    // Stop current processing and temporarily pause queue to prevent double-send
    if (onStop) onStop();
    const wasPaused = queuePausedRef.current;
    queuePausedRef.current = true;

    // Remove the message from queue and send it immediately
    setQueuedMessages((prev) => prev.filter((msg) => msg.id !== messageId));
    LocalMessageStorage.addMessage(messageToSend.content);
    handleSubmit({ msg: messageToSend.content, images: messageToSend.images });

    // Restore previous pause state after a brief delay to prevent race condition
    setTimeout(() => {
      queuePausedRef.current = wasPaused;
    }, 100);
  };

  const handleResumeQueue = () => {
    queuePausedRef.current = false;
    setLastInterruption(null);
    if (!isLoading && queuedMessages.length > 0) {
      const nextMessage = queuedMessages[0];
      LocalMessageStorage.addMessage(nextMessage.content);
      handleSubmit({ msg: nextMessage.content, images: nextMessage.images });
      setQueuedMessages((prev) => {
        const newQueue = prev.slice(1);
        // If queue becomes empty after processing, clear the paused state
        if (newQueue.length === 0) {
          queuePausedRef.current = false;
          setLastInterruption(null);
        }
        return newQueue;
      });
    }
  };

  return (
    <div
      className={`flex flex-col relative h-auto p-4 transition-colors ${
        disableAnimation ? '' : 'page-transition'
      } ${
        isFocused
          ? 'border-border-secondary hover:border-border-secondary'
          : 'border-border-primary hover:border-border-primary'
      } bg-background-primary z-10 rounded-t-2xl`}
      data-drop-zone="true"
      onDrop={handleLocalDrop}
      onDragOver={handleLocalDragOver}
    >
      {/* Message Queue Display */}
      {queuedMessages.length > 0 && (
        <MessageQueue
          queuedMessages={queuedMessages}
          onRemoveMessage={handleRemoveQueuedMessage}
          onClearQueue={handleClearQueue}
          onStopAndSend={handleStopAndSend}
          onReorderMessages={handleReorderMessages}
          onEditMessage={handleEditMessage}
          onTriggerQueueProcessing={handleResumeQueue}
          editingMessageIdRef={editingMessageIdRef}
          isPaused={queuePausedRef.current}
          className="border-b border-border-primary"
        />
      )}
      {/* Input row with inline action buttons wrapped in form */}
      <form onSubmit={onFormSubmit} className="relative">
        <div className="relative">
          <textarea
            data-testid="chat-input"
            autoFocus
            id="dynamic-textarea"
            placeholder="Введите сообщение"
            value={displayValue}
            onChange={handleChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            ref={textAreaRef}
            rows={1}
            style={{
              minHeight: `${minTextareaHeight}px`,
              maxHeight: `${maxHeight}px`,
              overflowY: 'auto',
              paddingRight: '120px',
            }}
            className="w-full outline-none border-none focus:ring-0 bg-transparent px-3 pt-3 pb-1.5 text-sm resize-none text-text-primary placeholder:text-text-secondary"
          />

          {/* Inline action buttons - absolutely positioned on the right */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {/* Send/Stop button */}
            {isLoading && !hasSubmittableContent ? (
              <Button
                type="button"
                onClick={onStop}
                size="sm"
                shape="round"
                variant="outline"
                className="bg-slate-600 text-white hover:bg-slate-700 border-slate-600 rounded-full px-6 py-2"
              >
                <Stop />
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      type="submit"
                      size="sm"
                      shape="round"
                      variant="outline"
                      disabled={isSubmitButtonDisabled}
                      className={`rounded-full min-w-[132px] px-4 py-2 flex items-center justify-center gap-2 ${
                        isSubmitButtonDisabled
                          ? 'bg-slate-600 text-white cursor-not-allowed opacity-50 border-slate-600'
                          : 'bg-slate-600 text-white hover:bg-slate-700 border-slate-600 hover:cursor-pointer'
                      }`}
                    >
                      <Send className="w-4 h-4" />
                      <span className="text-sm">Отправить</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{getSubmitButtonTooltip()}</p>
                </TooltipContent>
              </Tooltip>
            )}

          </div>
        </div>
      </form>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileInputChange}
        disabled={isFilePickerOpen}
      />

      {/* Files preview */}
      {allDroppedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 p-4 mt-2 border-t border-border-primary">
          {/* Render dropped files */}
          {allDroppedFiles.map((file) => (
            <div key={file.id} className="relative group">
              {file.isImage ? (
                // Image preview
                <div className="w-20 h-20">
                  {file.dataUrl && (
                    <img
                      src={file.dataUrl}
                      alt={file.name}
                      className={`w-full h-full object-cover rounded border ${file.error ? 'border-red-500' : 'border-border-primary'}`}
                    />
                  )}
                  {file.isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white"></div>
                    </div>
                  )}
                  {file.error && !file.isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-75 rounded p-1 text-center">
                      <p className="text-red-400 text-[10px] leading-tight break-all">
                        {file.error.substring(0, 30)}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                // File box preview
                <div
                  className={`flex items-center gap-2 px-3 py-2 bg-bgSubtle border rounded-lg min-w-[120px] max-w-[260px] ${
                    file.error ? 'border-red-500' : 'border-border-primary'
                  }`}
                >
                  <div className="flex-shrink-0 w-8 h-8 bg-background-primary border border-border-primary rounded flex items-center justify-center text-xs font-mono text-text-secondary">
                    {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate" title={file.name}>
                      {file.name}
                    </p>
                    {file.error ? (
                      <p className="text-xs text-red-500 truncate" title={file.error}>
                        {file.error}
                      </p>
                    ) : (
                      <p className="text-xs text-text-secondary">{file.type || 'Unknown type'}</p>
                    )}
                  </div>
                </div>
              )}
              {!file.isLoading && (
                <Button
                  type="button"
                  shape="round"
                  onClick={() => handleRemoveDroppedFile(file.id)}
                  className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity z-10"
                  aria-label="Remove file"
                  variant="outline"
                  size="xs"
                >
                  <Close />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Secondary actions row below input */}
      <div className="flex flex-row items-center gap-1 p-2 relative">
        <div className="z-[100] text-text-primary/70 text-xs flex items-center pl-1">
          <FolderDot className="mr-1" size={16} />
          <div className="max-w-[200px] truncate [direction:rtl]">
            {sessionWorkingDir ?? getInitialWorkingDir()}
          </div>
        </div>
        <div className="w-px h-4 bg-border-primary mx-2" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              onClick={handleFileSelect}
              disabled={isFilePickerOpen}
              variant="ghost"
              size="sm"
              className={`flex items-center justify-center text-text-primary/70 hover:text-text-primary text-xs transition-colors ${isFilePickerOpen ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <Attach className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Attach file</TooltipContent>
        </Tooltip>
        <MentionPopover
          ref={mentionPopoverRef}
          isOpen={mentionPopover.isOpen}
          isSlashCommand={mentionPopover.isSlashCommand}
          onClose={() => setMentionPopover((prev) => ({ ...prev, isOpen: false }))}
          onSelect={handleMentionItemSelect}
          position={mentionPopover.position}
          query={mentionPopover.query}
          selectedIndex={mentionPopover.selectedIndex}
          onSelectedIndexChange={(index) =>
            setMentionPopover((prev) => ({ ...prev, selectedIndex: index }))
          }
          workingDir={sessionWorkingDir ?? getInitialWorkingDir()}
        />
      </div>
    </div>
  );
}
