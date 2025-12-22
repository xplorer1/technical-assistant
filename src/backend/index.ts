/**
 * Backend module entry point
 *
 * This module contains the Express server and supporting services for the Technical Assistant.
 * The backend is organized into:
 * - server/: Express app configuration and route handlers
 * - services/: Business logic (QueryProcessor, RAGEngine, SessionManager)
 * - clients/: External service clients (OllamaClient)
 * - storage/: Data persistence (VectorStore, SessionStorage)
 *
 * When run directly, this file starts the server.
 * When imported, it exports the server factory functions.
 */

// Re-export server components
export {
    createApp,
    createServer,
    startServer,
    ApiError,
    DEFAULT_SERVER_CONFIG,
} from './server';

export type { ServerConfig } from './server';

// Re-export services
export * from './services';

// Re-export clients
export {
    OllamaClient,
    createOllamaClient,
    OllamaError,
    OllamaErrorCode,
    DEFAULT_OLLAMA_CONFIG,
} from './clients/ollamaClient';

export type { OllamaClientConfig, IOllamaClient } from './clients/ollamaClient';

// Main entry point - start server when run directly
// This check allows the file to be both imported and run directly
const isMainModule = require.main === module;

if (isMainModule) {
    const { createServer } = require('./server');

    createServer({}, true)
        .then(() => {
            console.log('Server started successfully');
        })
        .catch((error: Error) => {
            console.error('Failed to start server:', error);
            process.exit(1);
        });
}
