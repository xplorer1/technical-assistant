import React, { useState, useCallback, useRef, useEffect } from 'react';

/**
 * ChatInput Component
 *
 * Handles user text input and submission for the chat interface.
 * Addresses Requirement 4.1: "WHEN a user opens the application THEN the
 * Technical Assistant SHALL display a chat interface with a text input field"
 *
 * 1. Controlled component pattern - React manages the input state
 * 2. useCallback for memoized event handlers to prevent unnecessary re-renders
 * 3. Accessibility: proper labels, keyboard support, disabled states
 * 4. The component doesn't validate the query itself - that's the backend's job
 *    (separation of concerns), but we do prevent empty submissions for UX
 */

export interface ChatInputProps {
  /** Callback when user submits a message */
  onSubmit: (message: string) => void;
  /** Whether input should be disabled (e.g., during loading) */
  disabled?: boolean;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Auto-focus the input on mount */
  autoFocus?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSubmit,
  disabled = false,
  placeholder = 'Ask a technical question...',
  autoFocus = true,
}) => {
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount if enabled
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Handle form submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedMessage = message.trim();
      // Don't submit empty or whitespace-only messages (UX improvement)
      // Note: Backend also validates this per Requirement 1.3
      if (!trimmedMessage || disabled) {
        return;
      }

      onSubmit(trimmedMessage);
      setMessage('');
    },
    [message, disabled, onSubmit]
  );

  // Handle keyboard shortcuts (Enter to submit, Shift+Enter for newline)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  // Handle input change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMessage(e.target.value);
    },
    []
  );

  // Auto-resize textarea based on content
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const isSubmitDisabled = disabled || !message.trim();

  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      <div className="chat-input__container">
        <textarea
          ref={inputRef}
          className="chat-input__textarea"
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Message input"
          aria-describedby="chat-input-hint"
        />
        <button
          type="submit"
          className="chat-input__submit"
          disabled={isSubmitDisabled}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </div>
      <span id="chat-input-hint" className="chat-input__hint">
        Press Enter to send, Shift+Enter for new line
      </span>
    </form>
  );
};

/**
 * Simple send icon SVG component
 */
const SendIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export default ChatInput;
