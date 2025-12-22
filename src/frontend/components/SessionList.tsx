import React, { useCallback } from 'react';
import { ConversationSession } from '@shared/types';

/**
 * SessionList Component
 *
 * Displays and manages conversation sessions, allowing users to:
 * - View list of previous sessions (Requirement 6.1)
 * - Select a session to load its history (Requirement 6.2)
 * - Create new sessions (Requirement 6.3)
 *
 * 1. This component follows the "smart/dumb" component pattern - it receives
 *    data and callbacks as props, making it easy to test and reuse
 * 2. Session selection uses a callback pattern rather than internal routing,
 *    giving the parent component control over navigation behavior
 * 3. The component handles empty states gracefully for better UX
 */

export interface SessionListProps {
  /** Array of sessions to display */
  sessions: ConversationSession[];
  /** Currently active session ID */
  activeSessionId?: string;
  /** Callback when a session is selected */
  onSelectSession: (sessionId: string) => void;
  /** Callback when user wants to create a new session */
  onCreateSession: () => void;
  /** Whether sessions are currently loading */
  isLoading?: boolean;
}

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  isLoading = false,
}) => {
  // Sort sessions by most recently updated
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <aside className="session-list" aria-label="Conversation sessions">
      <div className="session-list__header">
        <h2 className="session-list__title">Conversations</h2>
        <button
          className="session-list__new-button"
          onClick={onCreateSession}
          aria-label="Start new conversation"
        >
          <PlusIcon />
          <span>New Chat</span>
        </button>
      </div>

      <div className="session-list__content">
        {isLoading ? (
          <div className="session-list__loading">
            <span>Loading sessions...</span>
          </div>
        ) : sortedSessions.length === 0 ? (
          <div className="session-list__empty">
            <p>No conversations yet.</p>
            <p>Start a new chat to begin!</p>
          </div>
        ) : (
          <ul className="session-list__items" role="listbox">
            {sortedSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={onSelectSession}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};

/**
 * SessionItem Component
 *
 * Renders a single session in the list with title, preview, and timestamp.
 */
interface SessionItemProps {
  session: ConversationSession;
  isActive: boolean;
  onSelect: (sessionId: string) => void;
}

const SessionItem: React.FC<SessionItemProps> = ({
  session,
  isActive,
  onSelect,
}) => {
  const handleClick = useCallback(() => {
    onSelect(session.id);
  }, [session.id, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(session.id);
      }
    },
    [session.id, onSelect]
  );

  // Get preview from last message or use default
  const preview = getSessionPreview(session);
  const timestamp = formatRelativeTime(session.updatedAt);

  return (
    <li
      className={`session-item ${isActive ? 'session-item--active' : ''}`}
      role="option"
      aria-selected={isActive}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="session-item__icon">
        <ChatIcon />
      </div>
      <div className="session-item__content">
        <span className="session-item__title">{session.title}</span>
        <span className="session-item__preview">{preview}</span>
      </div>
      <time className="session-item__timestamp" dateTime={session.updatedAt.toISOString()}>
        {timestamp}
      </time>
    </li>
  );
};

/**
 * Get a preview string from the session's messages
 */
function getSessionPreview(session: ConversationSession): string {
  if (session.messages.length === 0) {
    return 'No messages yet';
  }

  // Get the last user message for preview
  const lastUserMessage = [...session.messages]
    .reverse()
    .find((m) => m.role === 'user');

  if (lastUserMessage) {
    const content = lastUserMessage.content;
    return content.length > 50 ? `${content.substring(0, 50)}...` : content;
  }

  return `${session.messages.length} message${session.messages.length === 1 ? '' : 's'}`;
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "Yesterday")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const messageDate = new Date(date);
  const diffMs = now.getTime() - messageDate.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return 'Just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return messageDate.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Plus icon for new chat button
 */
const PlusIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/**
 * Chat icon for session items
 */
const ChatIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export default SessionList;
