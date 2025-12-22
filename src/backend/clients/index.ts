/**
 * External service clients
 *
 * Wrappers for external service communication:
 * - OllamaClient: Interface to local Ollama instance for LLM operations
 */

export {
    OllamaClient,
    createOllamaClient,
    OllamaError,
    OllamaErrorCode,
    DEFAULT_OLLAMA_CONFIG,
    type IOllamaClient,
    type OllamaClientConfig,
} from './ollamaClient';
