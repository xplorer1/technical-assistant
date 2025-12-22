import React, { useCallback, useState } from 'react';
import {
  ChatInput,
  MessageList,
  SessionList,
  LoadingIndicator,
  DocumentUpload,
} from './components';
import { useChat, useSessions, useHealth, useDocuments } from './hooks';
import './styles/app.css';

/**
 * Main Application Component
 *
 * Orchestrates the Technical Assistant UI by composing:
 * - SessionList: Sidebar for session management
 * - DocumentUpload: Panel for knowledge base management
 * - MessageList: Main chat area
 * - ChatInput: Message input
 *
 * Interview talking points:
 * 1. This is the "container" component that manages application state
 *    through custom hooks, while presentational components handle rendering
 *
 * 2. The component composition pattern keeps each piece focused and testable
 *
 * 3. Tab-based navigation allows switching between chat sessions and
 *    document management without losing state
 *
 * 4. Error boundaries could be added here for production robustness
 */

type SidebarTab = 'sessions' | 'documents';

export const App: React.FC = () => {
  // Sidebar tab state
  const [activeTab, setActiveTab] = useState<SidebarTab>('sessions');

  // Health monitoring
  const { isBackendHealthy, isOllamaHealthy, isChecking, error: healthError, checkHealth } =
    useHealth();

  // Session management
  const {
    sessions,
    isLoading: isLoadingSessions,
    getSession,
    refreshSessions,
  } = useSessions();

  // Document management
  const {
    documents,
    isLoading: isLoadingDocuments,
    error: documentError,
    uploadProgress,
    uploadDocument,
    deleteDocument,
    validateFile,
    clearError: clearDocumentError,
    clearUploadProgress,
  } = useDocuments();

  // Chat state
  const {
    messages,
    isLoading: isSendingMessage,
    error: chatError,
    sessionId,
    sendMessage,
    loadSession,
    startNewSession,
    clearError,
  } = useChat();

  /**
   * Handle session selection from the sidebar
   */
  const handleSelectSession = useCallback(
    async (selectedSessionId: string) => {
      const session = await getSession(selectedSessionId);
      if (session) {
        loadSession(session);
      }
    },
    [getSession, loadSession]
  );

  /**
   * Handle creating a new session
   */
  const handleCreateSession = useCallback(async () => {
    startNewSession();
    // Optionally create on server immediately, or wait until first message
    // For now, we just clear the UI - session is created on first message
  }, [startNewSession]);

  /**
   * Handle message submission
   */
  const handleSendMessage = useCallback(
    async (content: string) => {
      await sendMessage(content);
      // Refresh sessions to update the sidebar with new/updated session
      await refreshSessions();
    },
    [sendMessage, refreshSessions]
  );

  // Show loading state while checking health
  if (isChecking) {
    return (
      <div className="app app--loading">
        <LoadingIndicator message="Connecting to server..." size="large" />
      </div>
    );
  }

  // Show error state if backend is not healthy
  if (!isBackendHealthy) {
    return (
      <div className="app app--error">
        <div className="error-screen">
          <h1>Connection Error</h1>
          <p>{healthError || 'Cannot connect to the server.'}</p>
          <p>Please ensure the backend server is running and try again.</p>
          <button onClick={checkHealth} className="error-screen__retry">
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="app__sidebar">
        {/* Tab navigation */}
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tabs__tab ${
              activeTab === 'sessions' ? 'sidebar-tabs__tab--active' : ''
            }`}
            onClick={() => setActiveTab('sessions')}
          >
            💬 Sessions
          </button>
          <button
            className={`sidebar-tabs__tab ${
              activeTab === 'documents' ? 'sidebar-tabs__tab--active' : ''
            }`}
            onClick={() => setActiveTab('documents')}
          >
            📚 Documents
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'sessions' ? (
          <SessionList
            sessions={sessions}
            activeSessionId={sessionId ?? undefined}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            isLoading={isLoadingSessions}
          />
        ) : (
          <DocumentUpload
            documents={documents}
            isLoading={isLoadingDocuments}
            error={documentError}
            uploadProgress={uploadProgress}
            onUpload={uploadDocument}
            onDelete={deleteDocument}
            onValidate={validateFile}
            onClearError={clearDocumentError}
            onClearUploadProgress={clearUploadProgress}
          />
        )}
      </aside>

      {/* Main chat area */}
      <main className="app__main">
        {/* Ollama warning banner */}
        {!isOllamaHealthy && (
          <div className="app__warning">
            <span>⚠️ Ollama is not available. Responses may not work.</span>
            <button onClick={checkHealth}>Retry</button>
          </div>
        )}

        {/* Chat error banner */}
        {chatError && (
          <div className="app__error-banner">
            <span>{chatError}</span>
            <button onClick={clearError}>Dismiss</button>
          </div>
        )}

        {/* Message list */}
        <MessageList messages={messages} isLoading={isSendingMessage} />

        {/* Chat input */}
        <ChatInput
          onSubmit={handleSendMessage}
          disabled={isSendingMessage || !isOllamaHealthy}
          placeholder={
            isOllamaHealthy
              ? 'Ask a technical question...'
              : 'Ollama is not available'
          }
        />
      </main>
    </div>
  );
};

export default App;
