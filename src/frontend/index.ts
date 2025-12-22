/**
 * Frontend module entry point
 *
 * This module contains React components for the Technical Assistant chat interface.
 * Components are organized by feature area:
 * - components/: Reusable UI components (ChatInput, MessageList, etc.)
 * - hooks/: Custom React hooks for state management
 * - services/: API client and external service integrations
 */

// Component exports
export * from './components';

// Hook exports
export * from './hooks';

// Service exports
export * from './services';

// App component
export { App } from './App';
