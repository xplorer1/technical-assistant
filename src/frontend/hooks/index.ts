/**
 * Custom React hooks
 *
 * Hooks for managing application state and side effects:
 * - useChat: Manages chat state and message sending
 * - useSessions: Handles session CRUD operations
 * - useHealth: Monitors backend and Ollama health status
 */

export { useChat } from './useChat';
export type { UseChatReturn, UseChatState, UseChatActions } from './useChat';

export { useSessions } from './useSessions';
export type {
  UseSessionsReturn,
  UseSessionsState,
  UseSessionsActions,
} from './useSessions';

export { useHealth } from './useHealth';
export type {
  UseHealthReturn,
  UseHealthState,
  UseHealthActions,
} from './useHealth';

export { useDocuments, getSupportedFormatsText, SUPPORTED_EXTENSIONS, SUPPORTED_MIME_TYPES } from './useDocuments';
export type {
  UseDocumentsReturn,
  UseDocumentsState,
  UseDocumentsActions,
  UploadProgress,
} from './useDocuments';
