import React, { useEffect, useRef } from 'react';
import { ChatMessage, SourceReference } from '@shared/types';
import { LoadingIndicator } from './LoadingIndicator';
import { MessageContent } from './MessageContent';

/**
 * MessageList Component
 *
 * Renders the conversation history with proper formatting for both user
 * and assistant messages. Addresses Requirement 4.1: display conversation history.
 *
 * 1. Auto-scroll behavior - UX pattern for chat interfaces
 * 2. Conditional rendering based on message role
 * 3. Component composition - MessageItem handles individual message rendering
 * 4. The actual markdown/code formatting is handled by MessageContent (task 10.3)
 *    This component focuses on layout and structure (separation of concerns)
 */

export interface MessageListProps {
  /** Array of messages to display */
  messages: ChatMessage[];
  /** Whether a response is currently being generated */
  isLoading?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading = false,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="message-list message-list--empty">
        <div className="message-list__welcome">
          <h2>Welcome to Technical Assistant</h2>
          <p>Ask any technical question to get started.</p>
          <ul className="message-list__suggestions">
            <li>How do I implement a binary search?</li>
            <li>Explain the difference between REST and GraphQL</li>
            <li>What are React hooks and when should I use them?</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list" role="log" aria-live="polite">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      {isLoading && (
        <div className="message-list__loading">
          <LoadingIndicator message="Generating response..." />
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};

/**
 * MessageItem Component
 *
 * Renders a single message with appropriate styling based on role.
 * This is a presentational component focused on layout.
 */
interface MessageItemProps {
  message: ChatMessage;
}

const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const timestamp = formatTimestamp(message.timestamp);

  return (
    <div
      className={`message-item message-item--${message.role}`}
      data-testid={`message-${message.id}`}
    >
      <div className="message-item__avatar">
        {isUser ? <UserIcon /> : <AssistantIcon />}
      </div>
      <div className="message-item__content">
        <div className="message-item__header">
          <span className="message-item__role">
            {isUser ? 'You' : 'Assistant'}
          </span>
          <time className="message-item__timestamp" dateTime={message.timestamp.toISOString()}>
            {timestamp}
          </time>
        </div>
        <div className="message-item__body">
          <MessageContentWrapper content={message.content} />
        </div>
        {message.sources && message.sources.length > 0 && (
          <SourceReferences sources={message.sources} />
        )}
      </div>
    </div>
  );
};

/**
 * MessageContentWrapper Component
 *
 * Renders message content with full markdown support.
 * Uses the MessageContent component for proper formatting.
 */
interface MessageContentWrapperProps {
  content: string;
}

const MessageContentWrapper: React.FC<MessageContentWrapperProps> = ({ content }) => {
  return <MessageContent content={content} />;
};

/**
 * SourceReferences Component
 *
 * Displays source references for assistant responses.
 * Addresses Requirement 2.1: include source references where applicable.
 */
interface SourceReferencesProps {
  sources: SourceReference[];
}

const SourceReferences: React.FC<SourceReferencesProps> = ({ sources }) => {
  return (
    <div className="source-references">
      <h4 className="source-references__title">Sources</h4>
      <ul className="source-references__list">
        {sources.map((source, index) => (
          <li key={`${source.documentId}-${index}`} className="source-references__item">
            <span className="source-references__name">{source.documentName}</span>
            <blockquote className="source-references__excerpt">
              {source.excerpt}
            </blockquote>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Format timestamp for display
 */
function formatTimestamp(date: Date): string {
  const now = new Date();
  const messageDate = new Date(date);

  // If today, show time only
  if (messageDate.toDateString() === now.toDateString()) {
    return messageDate.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Otherwise show date and time
  return messageDate.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * User avatar icon
 */
const UserIcon: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
  </svg>
);

/**
 * Assistant avatar icon
 */
const AssistantIcon: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
  </svg>
);

export default MessageList;
