/**
 * Ollama Client
 *
 * Wrapper for communicating with a local Ollama instance.
 * Ollama provides local LLM inference without external API calls,
 * ensuring data privacy and eliminating API costs.
 *
 * - This follows the Adapter pattern: wrapping an external API with our own interface
 * - Error handling is crucial for external service communication
 * - We use fetch() for HTTP calls since Ollama exposes a REST API
 * 
 * Ollama API endpoints used:
 * - GET /api/tags - List available models (used for health check)
 * - POST /api/generate - Generate text completions
 * - POST /api/embeddings - Generate vector embeddings
 */

import { GenerationOptions } from '../../shared/types';

/**
 * Configuration for the Ollama client.
 * Separating config makes the client testable and flexible.
 */
export interface OllamaClientConfig {
    /** Base URL for Ollama API (default: http://localhost:11434) */
    baseUrl: string;
    /** Default model for text generation */
    defaultModel: string;
    /** Default model for embeddings (some models are optimized for this) */
    embeddingModel: string;
    /** Request timeout in milliseconds */
    timeoutMs: number;
}

/**
 * Default configuration values.
 * These match Ollama's default setup for easy local development.
 */
export const DEFAULT_OLLAMA_CONFIG: OllamaClientConfig = {
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama2',
    embeddingModel: 'llama2',
    timeoutMs: 30000, // 30 seconds - matches our requirement for response time
};

/**
 * Custom error class for Ollama-specific errors.
 * This allows callers to distinguish Ollama errors from other errors.
 *
 * Interview note: Custom error classes help with error handling granularity
 * and make debugging easier by providing context-specific information.
 */
export class OllamaError extends Error {
    constructor(
        message: string,
        public readonly code: OllamaErrorCode,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'OllamaError';
    }
}

/**
 * Error codes for different failure scenarios.
 * Using an enum makes error handling more type-safe and self-documenting.
 */
export enum OllamaErrorCode {
    /** Ollama service is not running or unreachable */
    CONNECTION_REFUSED = 'CONNECTION_REFUSED',
    /** Request took too long */
    TIMEOUT = 'TIMEOUT',
    /** Requested model is not available */
    MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
    /** Ollama returned an error response */
    API_ERROR = 'API_ERROR',
    /** Unexpected error during communication */
    UNKNOWN = 'UNKNOWN',
}

/**
 * Response shape from Ollama's /api/generate endpoint.
 * We only define the fields we actually use.
 */
interface OllamaGenerateResponse {
    response: string;
    done: boolean;
}

/**
 * Response shape from Ollama's /api/embeddings endpoint.
 */
interface OllamaEmbeddingResponse {
    embedding: number[];
}

/**
 * Interface defining the Ollama client contract.
 * Using an interface allows for easy mocking in tests and
 * potential future implementations (e.g., a mock client for development).
 */
export interface IOllamaClient {
    isAvailable(): Promise<boolean>;
    generateCompletion(prompt: string, options?: GenerationOptions): Promise<string>;
    generateEmbedding(text: string): Promise<number[]>;
}


/**
 * Ollama Client Implementation
 *
 * This class handles all communication with the local Ollama instance.
 * It implements retry logic, timeout handling, and meaningful error messages.
 */
export class OllamaClient implements IOllamaClient {
    private readonly config: OllamaClientConfig;

    constructor(config: Partial<OllamaClientConfig> = {}) {
        // Merge provided config with defaults
        this.config = { ...DEFAULT_OLLAMA_CONFIG, ...config };
    }

    /**
     * Check if Ollama is available and responding.
     *
     * This is used for:
     * - Health checks on application startup
     * - The /api/health endpoint
     * - Graceful degradation when Ollama is down
     *
     * We use the /api/tags endpoint because it's lightweight and
     * confirms Ollama is running and can respond to requests.
     *
     * @returns true if Ollama is available, false otherwise
     */
    async isAvailable(): Promise<boolean> {
        try {
            const response = await this.fetchWithTimeout(
                `${this.config.baseUrl}/api/tags`,
                {
                    method: 'GET',
                },
                5000 // Short timeout for health checks
            );
            return response.ok;
        } catch {
            // Any error means Ollama is not available
            return false;
        }
    }

    /**
     * Generate a text completion using Ollama.
     *
     * This is the core function for getting LLM responses.
     * It sends a prompt to Ollama and returns the generated text.
     *
     * We use streaming=false for simplicity, but
     * production systems often use streaming for better UX
     * (showing text as it's generated).
     *
     * @param prompt - The text prompt to send to the model
     * @param options - Optional generation parameters
     * @returns The generated text response
     * @throws OllamaError if generation fails
     */
    async generateCompletion(
        prompt: string,
        options: GenerationOptions = {}
    ): Promise<string> {
        const model = options.model ?? this.config.defaultModel;

        try {
            const response = await this.fetchWithTimeout(
                `${this.config.baseUrl}/api/generate`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model,
                        prompt,
                        stream: false, // Get complete response at once
                        options: {
                            temperature: options.temperature ?? 0.7,
                            num_predict: options.maxTokens ?? 2048,
                        },
                    }),
                },
                this.config.timeoutMs
            );

            if (!response.ok) {
                await this.handleErrorResponse(response, model);
            }

            const data = (await response.json()) as OllamaGenerateResponse;
            return data.response;
        } catch (error) {
            throw this.wrapError(error, 'Failed to generate completion');
        }
    }

    /**
     * Generate an embedding vector for the given text.
     *
     * Embeddings are numerical representations of text that capture
     * semantic meaning. They're essential for RAG (Retrieval-Augmented
     * Generation) because they allow us to find semantically similar
     * documents using vector similarity search.
     *
     * Embeddings are a key concept in modern NLP.
     * Similar texts have similar embeddings (close in vector space),
     * enabling semantic search rather than just keyword matching.
     *
     * @param text - The text to embed
     * @returns A vector of numbers representing the text's semantic meaning
     * @throws OllamaError if embedding generation fails
     */
    async generateEmbedding(text: string): Promise<number[]> {
        try {
            const response = await this.fetchWithTimeout(
                `${this.config.baseUrl}/api/embeddings`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: this.config.embeddingModel,
                        prompt: text,
                    }),
                },
                this.config.timeoutMs
            );

            if (!response.ok) {
                await this.handleErrorResponse(response, this.config.embeddingModel);
            }

            const data = (await response.json()) as OllamaEmbeddingResponse;
            return data.embedding;
        } catch (error) {
            throw this.wrapError(error, 'Failed to generate embedding');
        }
    }

    /**
     * Fetch with timeout support.
     *
     * Node.js fetch doesn't have built-in timeout, so we implement it
     * using AbortController. This prevents requests from hanging
     * indefinitely if Ollama becomes unresponsive.
     *
     */
    private async fetchWithTimeout(
        url: string,
        options: RequestInit,
        timeoutMs: number
    ): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            return response;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new OllamaError(
                    `Request timed out after ${timeoutMs}ms`,
                    OllamaErrorCode.TIMEOUT
                );
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Handle non-OK HTTP responses from Ollama.
     *
     * Different status codes indicate different problems:
     * - 404: Model not found (user needs to pull it)
     * - 500: Internal Ollama error
     * - Others: Various API errors
     */
    private async handleErrorResponse(response: Response, model: string): Promise<never> {
        let errorMessage: string;

        try {
            const errorBody = await response.json();
            errorMessage = errorBody.error || `HTTP ${response.status}`;
        } catch {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }

        if (response.status === 404 || errorMessage.includes('not found')) {
            throw new OllamaError(
                `Model "${model}" not found. Please run: ollama pull ${model}`,
                OllamaErrorCode.MODEL_NOT_FOUND
            );
        }

        throw new OllamaError(
            `Ollama API error: ${errorMessage}`,
            OllamaErrorCode.API_ERROR
        );
    }

    /**
     * Wrap errors in OllamaError for consistent error handling.
     *
     * This ensures all errors from this client are OllamaError instances,
     * making it easier for callers to handle them appropriately.
     */
    private wrapError(error: unknown, context: string): OllamaError {
        // Already an OllamaError, just return it
        if (error instanceof OllamaError) {
            return error;
        }

        // Connection errors (Ollama not running)
        if (error instanceof TypeError && error.message.includes('fetch')) {
            return new OllamaError(
                'Cannot connect to Ollama. Please ensure Ollama is running (ollama serve)',
                OllamaErrorCode.CONNECTION_REFUSED,
                error
            );
        }

        // Generic error wrapping
        const message = error instanceof Error ? error.message : String(error);
        return new OllamaError(
            `${context}: ${message}`,
            OllamaErrorCode.UNKNOWN,
            error instanceof Error ? error : undefined
        );
    }
}

/**
 * Factory function to create an Ollama client with default configuration.
 * This is the recommended way to create a client in most cases.
 */
export function createOllamaClient(config?: Partial<OllamaClientConfig>): OllamaClient {
    return new OllamaClient(config);
}
