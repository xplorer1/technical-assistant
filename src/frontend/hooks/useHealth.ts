import { useState, useCallback, useEffect } from 'react';
import { api, ApiError } from '../services/apiClient';

/**
 * useHealth Hook
 *
 * Monitors the health status of the backend and Ollama connection.
 * Addresses Requirement 5.2: Display clear error message and retry options
 * when Ollama service is unavailable.
 *
 * 1. Health checks are important for user experience - we want to show
 *    a clear message if the backend or Ollama is down, rather than
 *    letting users try to send messages that will fail
 *
 * 2. The hook provides a retry mechanism, which is better UX than
 *    requiring users to refresh the page
 *
 * 3. We check health on mount and provide a manual refresh option
 */

export interface UseHealthState {
  /** Whether the backend is reachable */
  isBackendHealthy: boolean;
  /** Whether Ollama is connected */
  isOllamaHealthy: boolean;
  /** Whether health check is in progress */
  isChecking: boolean;
  /** Error message if health check failed */
  error: string | null;
}

export interface UseHealthActions {
  /** Manually trigger a health check */
  checkHealth: () => Promise<void>;
}

export type UseHealthReturn = UseHealthState & UseHealthActions;

export function useHealth(): UseHealthReturn {
  const [isBackendHealthy, setIsBackendHealthy] = useState(false);
  const [isOllamaHealthy, setIsOllamaHealthy] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Check the health of backend and Ollama
   */
  const checkHealth = useCallback(async () => {
    setIsChecking(true);
    setError(null);

    try {
      const health = await api.checkHealth();

      setIsBackendHealthy(health.status === 'ok');
      setIsOllamaHealthy(health.ollama);

      if (!health.ollama) {
        setError(
          'Ollama is not available. Please ensure Ollama is running and try again.'
        );
      }
    } catch (err) {
      setIsBackendHealthy(false);
      setIsOllamaHealthy(false);

      const errorMessage =
        err instanceof ApiError
          ? err.message
          : 'Cannot connect to the server. Please ensure the backend is running.';

      setError(errorMessage);
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Check health on mount
  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  return {
    isBackendHealthy,
    isOllamaHealthy,
    isChecking,
    error,
    checkHealth,
  };
}

export default useHealth;
