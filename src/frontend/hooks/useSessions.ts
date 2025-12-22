import { useState, useCallback, useEffect } from 'react';
import { ConversationSession } from '@shared/types';
import { api, ApiError } from '../services/apiClient';

/**
 * useSessions Hook
 *
 * Manages session list state and CRUD operations.
 * Addresses Requirements:
 * - 6.1: Display list of previous conversation sessions
 * - 6.2: Load and display full conversation history
 * - 6.3: Create new sessions and persist to local storage
 *
 * Interview talking points:
 * 1. This hook separates session management from chat logic, following
 *    the single responsibility principle
 *
 * 2. We fetch sessions on mount (useEffect with empty deps) to populate
 *    the sidebar immediately when the app loads
 *
 * 3. The hook provides both the data (sessions) and the actions (create, refresh)
 *    following the "state + actions" pattern common in React hooks
 */

export interface UseSessionsState {
  /** List of all sessions */
  sessions: ConversationSession[];
  /** Whether sessions are being loaded */
  isLoading: boolean;
  /** Current error, if any */
  error: string | null;
}

export interface UseSessionsActions {
  /** Refresh the sessions list from the server */
  refreshSessions: () => Promise<void>;
  /** Create a new session */
  createSession: () => Promise<ConversationSession | null>;
  /** Get a specific session by ID */
  getSession: (sessionId: string) => Promise<ConversationSession | null>;
  /** Clear the current error */
  clearError: () => void;
}

export type UseSessionsReturn = UseSessionsState & UseSessionsActions;

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch all sessions from the server
   */
  const refreshSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const fetchedSessions = await api.getSessions();
      setSessions(fetchedSessions);
    } catch (err) {
      const errorMessage =
        err instanceof ApiError
          ? err.message
          : 'Failed to load sessions. Please try again.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create a new session
   */
  const createSession = useCallback(async (): Promise<ConversationSession | null> => {
    setError(null);

    try {
      const newSession = await api.createSession();
      // Add to local state
      setSessions((prev) => [newSession, ...prev]);
      return newSession;
    } catch (err) {
      const errorMessage =
        err instanceof ApiError
          ? err.message
          : 'Failed to create session. Please try again.';
      setError(errorMessage);
      return null;
    }
  }, []);

  /**
   * Get a specific session by ID
   */
  const getSession = useCallback(
    async (sessionId: string): Promise<ConversationSession | null> => {
      setError(null);

      try {
        const session = await api.getSession(sessionId);
        return session;
      } catch (err) {
        const errorMessage =
          err instanceof ApiError
            ? err.message
            : 'Failed to load session. Please try again.';
        setError(errorMessage);
        return null;
      }
    },
    []
  );

  /**
   * Clear the current error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Fetch sessions on mount
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return {
    sessions,
    isLoading,
    error,
    refreshSessions,
    createSession,
    getSession,
    clearError,
  };
}

export default useSessions;
