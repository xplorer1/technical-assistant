import React from 'react';

/**
 * LoadingIndicator Component
 *
 * Displays a visual indicator while the assistant is processing a query.
 * This addresses Requirement 4.2: "WHEN a user sends a message THEN the
 * Technical Assistant SHALL display a loading indicator until the response is ready"
 *
 * Interview talking point: This is a simple presentational component that follows
 * the single responsibility principle - it only handles displaying loading state.
 * The actual loading state management happens in the parent component or custom hook.
 */

export interface LoadingIndicatorProps {
  /** Optional custom message to display */
  message?: string;
  /** Size variant for different contexts */
  size?: 'small' | 'medium' | 'large';
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = 'Thinking...',
  size = 'medium',
}) => {
  const sizeClasses = {
    small: 'loading-indicator--small',
    medium: 'loading-indicator--medium',
    large: 'loading-indicator--large',
  };

  return (
    <div
      className={`loading-indicator ${sizeClasses[size]}`}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div className="loading-indicator__spinner">
        <div className="loading-indicator__dot"></div>
        <div className="loading-indicator__dot"></div>
        <div className="loading-indicator__dot"></div>
      </div>
      {message && (
        <span className="loading-indicator__message">{message}</span>
      )}
    </div>
  );
};

export default LoadingIndicator;
