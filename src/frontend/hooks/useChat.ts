import { useState, useCallback } from 'react';
import { ChatMessage, ConversationSession } from '@shared/types';
import { api, ApiError } from '../services/apiClient';

/**
 * useChat Hook
 *
 * Manages chat state including messages, loading state, and error handling.
 * Addresses Requirements:
 * - 1.1: Process queries and generate responses
 * - 1.2: Maintain conversation context
 * - 4.2: Display loading indicator until response is ready
 *
 * Interview talking points:
 * 1. Custom hooks encapsulate related state and logic, making components
 *    cleaner and enabling reuse across the application
 *
 * 2. The hook manages optimistic updates - we add the user message immediately
 *    for better UX, then add the assistant response when it arrives
 *
 * 3. Error state is separate from loading state, allowing the UI to show
 *    both the error message and a retry option
 */

export interface UseChatState {
  /** Current messages in the conversation */
  messages: ChatMessage[];
  /** Whether a message is being processed */
  isLoading: boolean;
  /** Current error, if any */
  error: string | null;
  /** Current session ID */
  sessionId: string | null;
}

export interface UseChatActions {
  /** Send a new message */
  sendMessage: (content: string) => Promise<void>;
  /** Load an existing session */
  loadSession: (session: ConversationSession) => void;
  /** Start a new session */
  startNewSession: () => void;
  /** Clear the current error */
  clearError: () => void;
}

export type UseChatReturn = UseChatState & UseChatActions;

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  /**
   * Send a message and get a response from the assistant
   */
  const sendMessage = useCallback(
    async (content: string) => {
      // Don't send if already loading or content is empty
      if (isLoading || !content.trim()) {
        return;
      }

      setIsLoading(true);
      setError(null);

      // Create optimistic user message
      const userMessage: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: content.trim(),
        timestamp: new Date(),
      };

      // Add user message immediately for better UX
      setMessages((prev) => [...prev, userMessage]);

      try {
        // Send to API
        const response = await api.sendMessage(content, sessionId ?? undefined);

        // Update session ID if this is a new session
        if (!sessionId) {
          setSessionId(response.sessionId);
        }

        // Add assistant response
        const assistantMessage: ChatMessage = {
          ...response.response,
          timestamp: new Date(response.response.timestamp),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        // Handle error
        const errorMessage =
          err instanceof ApiError
            ? err.message
            : 'Failed to send message. Please try again.';

        setError(errorMessage);

        // Remove the optimistic user message on error
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, sessionId]
  );

  /**
   * Load an existing session's messages
   */
  const loadSession = useCallback((session: ConversationSession) => {
    setSessionId(session.id);
    setMessages(session.messages);
    setError(null);
  }, []);

  /**
   * Start a fresh session
   */
  const startNewSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setError(null);
  }, []);

  /**
   * Clear the current error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sessionId,
    sendMessage,
    loadSession,
    startNewSession,
    clearError,
  };
}

export default useChat;
