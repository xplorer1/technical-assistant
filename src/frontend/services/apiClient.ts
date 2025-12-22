/**
 * API Client for Technical Assistant
 *
 * Handles all HTTP communication with the backend server.
 * Addresses Requirements:
 * - 4.2: Handle loading and error states
 * - 5.2: Display clear error messages when Ollama is unavailable
 *
 * 1. This follows the "service layer" pattern - all API calls go through
 *    a single module, making it easy to:
 *    - Add authentication headers
 *    - Handle errors consistently
 *    - Mock for testing
 *    - Change the base URL for different environments
 *
 * 2. We use TypeScript generics for type-safe responses
 *
 * 3. Error handling is centralized - the client throws typed errors
 *    that components can catch and display appropriately
 */

import {
  ChatRequest,
  ChatResponse,
  ConversationSession,
  Document,
  DocumentUploadResponse,
  HealthResponse,
} from '@shared/types';

// Base URL for API requests - uses Vite's proxy in development
const API_BASE_URL = '/api';

/**
 * Custom error class for API errors
 * Includes status code and original response for detailed error handling
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  // Handle non-OK responses
  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }

    const message =
      typeof errorData === 'object' &&
      errorData !== null &&
      'error' in errorData
        ? String((errorData as { error: unknown }).error)
        : `Request failed with status ${response.status}`;

    throw new ApiError(message, response.status, errorData);
  }

  // Parse JSON response
  return response.json() as Promise<T>;
}

// ============================================================================
// Health API
// ============================================================================

/**
 * Check the health status of the backend and Ollama connection
 */
export async function checkHealth(): Promise<HealthResponse> {
  return fetchApi<HealthResponse>('/health');
}

// ============================================================================
// Chat API
// ============================================================================

/**
 * Send a chat message and receive a response
 *
 * @param message - The user's message
 * @param sessionId - Optional session ID for conversation context
 * @returns The assistant's response and session ID
 */
export async function sendMessage(
  message: string,
  sessionId?: string
): Promise<ChatResponse> {
  const request: ChatRequest = {
    message,
    sessionId,
  };

  return fetchApi<ChatResponse>('/chat', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

// ============================================================================
// Session API
// ============================================================================

/**
 * Get all conversation sessions
 */
export async function getSessions(): Promise<ConversationSession[]> {
  const response = await fetchApi<{ sessions: ConversationSession[] }>(
    '/sessions'
  );
  // Convert date strings to Date objects
  return response.sessions.map(deserializeSession);
}

/**
 * Get a specific session by ID
 */
export async function getSession(
  sessionId: string
): Promise<ConversationSession> {
  const response = await fetchApi<{ session: ConversationSession }>(
    `/sessions/${sessionId}`
  );
  return deserializeSession(response.session);
}

/**
 * Create a new conversation session
 */
export async function createSession(): Promise<ConversationSession> {
  const response = await fetchApi<{ session: ConversationSession }>(
    '/sessions',
    {
      method: 'POST',
    }
  );
  return deserializeSession(response.session);
}

/**
 * Helper to convert date strings to Date objects in session data
 */
function deserializeSession(session: ConversationSession): ConversationSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
    messages: session.messages.map((msg) => ({
      ...msg,
      timestamp: new Date(msg.timestamp),
    })),
  };
}

// ============================================================================
// Document API
// ============================================================================

/**
 * Get all indexed documents
 */
export async function getDocuments(): Promise<Document[]> {
  const response = await fetchApi<{ documents: Document[] }>('/documents');
  return response.documents.map((doc) => ({
    ...doc,
    uploadedAt: new Date(doc.uploadedAt),
    indexedAt: doc.indexedAt ? new Date(doc.indexedAt) : undefined,
  }));
}

/**
 * Upload a document for indexing
 *
 * Note: This uses FormData instead of JSON for file upload
 */
export async function uploadDocument(
  file: File
): Promise<DocumentUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/documents`, {
    method: 'POST',
    body: formData,
    // Don't set Content-Type header - browser will set it with boundary
  });

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }

    const message =
      typeof errorData === 'object' &&
      errorData !== null &&
      'error' in errorData
        ? String((errorData as { error: unknown }).error)
        : `Upload failed with status ${response.status}`;

    throw new ApiError(message, response.status, errorData);
  }

  return response.json() as Promise<DocumentUploadResponse>;
}

/**
 * Delete a document from the knowledge base
 */
export async function deleteDocument(
  documentId: string
): Promise<{ success: boolean }> {
  return fetchApi<{ success: boolean }>(`/documents/${documentId}`, {
    method: 'DELETE',
  });
}

// Export all API functions as a namespace for convenience
export const api = {
  checkHealth,
  sendMessage,
  getSessions,
  getSession,
  createSession,
  getDocuments,
  uploadDocument,
  deleteDocument,
};

export default api;
