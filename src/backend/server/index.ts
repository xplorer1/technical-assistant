/**
 * Express Server Configuration and Routes
 *
 * This is the HTTP layer of the Technical Assistant backend.
 * It exposes REST endpoints for:
 * - Health checks (Ollama connectivity)
 * - Chat interactions (query processing)
 * - Session management (conversation persistence)
 * - Document management (knowledge base)
 *
 * ARCHITECTURE NOTES:
 * - Express is used for its simplicity and wide ecosystem
 * - CORS is enabled for frontend communication
 * - JSON middleware parses request bodies automatically
 * - Error handling middleware catches unhandled errors
 *
 * - Middleware pattern: Request flows through a chain of handlers
 * - Separation of concerns: Routes delegate to services
 * - Error handling: Centralized error middleware for consistency
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { createOllamaClient, IOllamaClient } from '../clients/ollamaClient';
import {
    HealthResponse,
    ChatRequest,
    ChatResponse,
    ChatMessage,
    DocumentType,
    DocumentUploadResponse,
} from '../../shared/types';
import {
    validateQuery,
    SessionManager,
    createSessionManager,
    createRAGEngine,
    createVectorStore,
    formatResponse,
    IRAGEngine,
    createDocumentStorage,
    IDocumentStorage,
    detectDocumentType,
} from '../services';

/**
 * Server configuration options.
 */
export interface ServerConfig {
    /** Port to listen on */
    port: number;
    /** CORS origin (default: allow all) */
    corsOrigin?: string;
    /** Ollama client instance (for dependency injection) */
    ollamaClient?: IOllamaClient;
    /** Session manager instance (for dependency injection) */
    sessionManager?: SessionManager;
    /** RAG engine instance (for dependency injection) */
    ragEngine?: IRAGEngine;
    /** Document storage instance (for dependency injection) */
    documentStorage?: IDocumentStorage;
}

/**
 * Default server configuration.
 */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
    port: 3001,
    corsOrigin: '*',
};

/**
 * Custom error class for API errors.
 * Includes HTTP status code for proper response handling.
 */
export class ApiError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number = 500,
        public readonly code?: string
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

/**
 * Creates and configures the Express application.
 *
 * WHY SEPARATE CREATE FROM LISTEN:
 * - Testability: We can create the app without starting the server
 * - Flexibility: Allows different configurations for dev/test/prod
 * - Composability: App can be mounted as middleware in another app
 *
 * @param config - Server configuration options
 * @returns Configured Express application
 */
export function createApp(config: Partial<ServerConfig> = {}): Express {
    const mergedConfig = { ...DEFAULT_SERVER_CONFIG, ...config };
    const app = express();

    // Create Ollama client (use injected or create new)
    const ollamaClient = mergedConfig.ollamaClient || createOllamaClient();

    // Create session manager (use injected or create new)
    const sessionManager = mergedConfig.sessionManager || createSessionManager();

    // Create RAG engine (use injected or create new)
    const vectorStore = createVectorStore();
    const ragEngine = mergedConfig.ragEngine || createRAGEngine(ollamaClient, vectorStore);

    // Create document storage (use injected or create new)
    const documentStorage = mergedConfig.documentStorage || createDocumentStorage();

    // =========================================================================
    // Middleware Setup
    // =========================================================================

    // CORS: Cross-Origin Resource Sharing
    // Allows the frontend (running on a different port) to call our API
    app.use(
        cors({
            origin: mergedConfig.corsOrigin,
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            allowedHeaders: ['Content-Type', 'Authorization'],
        })
    );

    // JSON body parser
    // Automatically parses JSON request bodies into req.body
    app.use(express.json({ limit: '10mb' })); // 10MB limit for document uploads

    // Configure multer for file uploads
    // Store files in memory as Buffer (for small files like docs)
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 10 * 1024 * 1024, // 10MB limit
        },
    });

    // Request logging (simple version - production would use morgan or similar)
    app.use((req: Request, _res: Response, next: NextFunction) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
        next();
    });

    // =========================================================================
    // Health Endpoint
    // =========================================================================

    /**
     * GET /api/health
     *
     * Health check endpoint that verifies:
     * 1. The server is running
     * 2. Ollama is available and responding
     *
     * WHY THIS MATTERS:
     * - Load balancers use health checks to route traffic
     * - Monitoring systems use it to detect outages
     * - Frontend can check before showing the chat interface
     *
     * Requirements: 5.1, 5.2
     */
    app.get('/api/health', async (_req: Request, res: Response) => {
        try {
            const ollamaAvailable = await ollamaClient.isAvailable();

            const response: HealthResponse = {
                status: ollamaAvailable ? 'ok' : 'error',
                ollama: ollamaAvailable,
            };

            // Return 503 Service Unavailable if Ollama is down
            // This helps load balancers know the service isn't fully functional
            const statusCode = ollamaAvailable ? 200 : 503;

            res.status(statusCode).json(response);
        } catch (error) {
            console.error('Health check error:', error);
            res.status(503).json({
                status: 'error',
                ollama: false,
            } as HealthResponse);
        }
    });

    // =========================================================================
    // Chat Endpoints
    // =========================================================================

    /**
     * POST /api/chat
     *
     * Send a message and receive an AI-generated response.
     *
     * This is the main interaction endpoint that:
     * 1. Validates the user's query
     * 2. Creates or retrieves a session
     * 3. Uses RAG to generate a contextual response
     * 4. Persists the conversation
     *
     * WHY THIS DESIGN:
     * - Session management enables conversation continuity (Requirement 1.2)
     * - RAG integration grounds responses in team knowledge
     * - Response formatting ensures consistent presentation
     *
     * Requirements: 1.1, 1.2
     */
    app.post('/api/chat', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { sessionId, message } = req.body as ChatRequest;

            // Step 1: Validate the query (Requirement 1.3)
            const validation = validateQuery(message);
            if (!validation.valid) {
                res.status(400).json({
                    error: validation.error,
                    code: 'INVALID_QUERY',
                });
                return;
            }

            // Step 2: Get or create session
            let session;
            let currentSessionId: string;

            if (sessionId) {
                session = await sessionManager.getSession(sessionId);
                if (!session) {
                    // Session not found - create a new one
                    session = await sessionManager.createSession();
                    currentSessionId = session.id;
                } else {
                    currentSessionId = sessionId;
                }
            } else {
                // No session ID provided - create new session
                session = await sessionManager.createSession();
                currentSessionId = session.id;
            }

            // Step 3: Create and save user message
            const userMessage: ChatMessage = {
                id: uuidv4(),
                role: 'user',
                content: message,
                timestamp: new Date(),
            };
            await sessionManager.addMessage(currentSessionId, userMessage);

            // Step 4: Get conversation history for context
            const updatedSession = await sessionManager.getSession(currentSessionId);
            const conversationHistory = updatedSession?.messages.slice(0, -1) || []; // Exclude current message

            // Step 5: Generate response using RAG engine
            const ragResponse = await ragEngine.generateResponse(message, conversationHistory);

            // Step 6: Format the response
            const formattedResponse = formatResponse(ragResponse.content, ragResponse.sources);

            // Step 7: Create and save assistant message
            const assistantMessage: ChatMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: formattedResponse.content,
                timestamp: new Date(),
                sources: ragResponse.sources.length > 0 ? ragResponse.sources : undefined,
            };
            await sessionManager.addMessage(currentSessionId, assistantMessage);

            // Step 8: Return response
            const response: ChatResponse = {
                sessionId: currentSessionId,
                response: assistantMessage,
            };

            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    // =========================================================================
    // Session Endpoints
    // =========================================================================

    /**
     * GET /api/sessions
     *
     * List all conversation sessions.
     *
     * Returns sessions sorted by most recently updated first,
     * allowing users to quickly find recent conversations.
     *
     * Requirements: 6.1
     */
    app.get('/api/sessions', async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const sessions = await sessionManager.listSessions();
            res.json({ sessions });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/sessions/:id
     *
     * Retrieve a specific session by ID.
     *
     * Returns the full conversation history for the session,
     * enabling users to continue past discussions.
     *
     * Requirements: 6.2
     */
    app.get('/api/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = req.params.id;
            if (!id) {
                res.status(400).json({
                    error: 'Session ID is required',
                    code: 'MISSING_SESSION_ID',
                });
                return;
            }
            const session = await sessionManager.getSession(id);

            if (!session) {
                res.status(404).json({
                    error: 'Session not found',
                    code: 'SESSION_NOT_FOUND',
                });
                return;
            }

            res.json({ session });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/sessions
     *
     * Create a new conversation session.
     *
     * Creates an empty session that can be used for a new conversation.
     * The session is persisted immediately to local storage.
     *
     * Requirements: 6.3
     */
    app.post('/api/sessions', async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const session = await sessionManager.createSession();
            res.status(201).json({ session });
        } catch (error) {
            next(error);
        }
    });

    // =========================================================================
    // Document Management Endpoints
    // =========================================================================

    /**
     * POST /api/documents
     *
     * Upload and index a document for the knowledge base.
     *
     * This endpoint:
     * 1. Accepts file upload via multipart/form-data
     * 2. Detects document type from filename
     * 3. Stores the document
     * 4. Indexes it for RAG retrieval
     *
     * WHY THIS DESIGN:
     * - Async indexing allows quick upload response
     * - Document type detection simplifies client code
     * - RAG integration enables knowledge-grounded responses
     *
     * Requirements: 3.1, 3.2
     */
    app.post('/api/documents', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const file = req.file;

            // Validate file was uploaded
            if (!file) {
                res.status(400).json({
                    error: 'No file uploaded. Please select a file to upload.',
                    code: 'MISSING_FILE',
                });
                return;
            }

            const name = file.originalname;
            
            // Detect document type from filename
            const type = detectDocumentType(name);
            if (!type) {
                res.status(400).json({
                    error: 'Unsupported document format. Supported formats: .md, .txt, .pdf',
                    code: 'UNSUPPORTED_FORMAT',
                });
                return;
            }

            // Convert buffer to string for text files, or base64 for PDF
            let content: string;
            if (type === 'pdf') {
                // PDF files need to be stored as base64 for later parsing
                content = file.buffer.toString('base64');
            } else {
                // Text files (markdown, txt) are stored as UTF-8 strings
                content = file.buffer.toString('utf-8');
            }

            // Save document
            const document = await documentStorage.saveDocument(name, type, content);

            // Index document asynchronously (don't block response)
            // In production, this would be a background job
            indexDocumentAsync(document.id, document, ragEngine, documentStorage);

            const response: DocumentUploadResponse = {
                documentId: document.id,
                status: document.status,
            };

            res.status(201).json(response);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/documents
     *
     * List all documents in the knowledge base.
     *
     * Returns documents sorted by upload date (newest first),
     * with their indexing status.
     *
     * Requirements: 3.1
     */
    app.get('/api/documents', async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const documents = await documentStorage.listDocuments();

            // Return documents without content (for listing)
            const documentList = documents.map((doc) => ({
                id: doc.id,
                name: doc.name,
                type: doc.type,
                uploadedAt: doc.uploadedAt,
                indexedAt: doc.indexedAt,
                status: doc.status,
                chunkCount: doc.chunkCount,
            }));

            res.json({ documents: documentList });
        } catch (error) {
            next(error);
        }
    });

    /**
     * DELETE /api/documents/:id
     *
     * Remove a document from the knowledge base.
     *
     * This removes both the stored document and its indexed chunks
     * from the vector store.
     *
     * Requirements: 3.1
     */
    app.delete('/api/documents/:id', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = req.params.id;
            if (!id) {
                res.status(400).json({
                    error: 'Document ID is required',
                    code: 'MISSING_DOCUMENT_ID',
                });
                return;
            }

            // Remove from vector store first
            ragEngine.removeDocument(id);

            // Then remove from storage
            const deleted = await documentStorage.deleteDocument(id);

            if (!deleted) {
                res.status(404).json({
                    error: 'Document not found',
                    code: 'DOCUMENT_NOT_FOUND',
                });
                return;
            }

            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    // =========================================================================
    // Error Handling Middleware
    // =========================================================================

    /**
     * Global error handler.
     *
     * This catches any errors thrown in route handlers.
     * It provides consistent error response format across all endpoints.
     *
     * WHY CENTRALIZED ERROR HANDLING:
     * - Consistency: All errors have the same response shape
     * - Security: Prevents leaking stack traces in production
     * - Logging: Single place to log all errors
     */
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        console.error('Unhandled error:', err);

        if (err instanceof ApiError) {
            res.status(err.statusCode).json({
                error: err.message,
                code: err.code,
            });
            return;
        }

        // Generic error response (don't leak internal details)
        res.status(500).json({
            error: 'Internal server error',
        });
    });

    return app;
}

/**
 * Starts the Express server.
 *
 * @param app - The Express application to start
 * @param port - Port to listen on
 * @returns Promise that resolves when server is listening
 */
export function startServer(
    app: Express,
    port: number = DEFAULT_SERVER_CONFIG.port
): Promise<void> {
    return new Promise((resolve) => {
        app.listen(port, () => {
            console.log(`Technical Assistant server running on port ${port}`);
            console.log(`Health check: http://localhost:${port}/api/health`);
            resolve();
        });
    });
}

/**
 * Factory function to create and optionally start the server.
 *
 * @param config - Server configuration
 * @param autoStart - Whether to start the server immediately
 * @returns The Express app (and starts listening if autoStart is true)
 */
export async function createServer(
    config: Partial<ServerConfig> = {},
    autoStart: boolean = false
): Promise<Express> {
    const app = createApp(config);

    if (autoStart) {
        const port = config.port || DEFAULT_SERVER_CONFIG.port;
        await startServer(app, port);
    }

    return app;
}

/**
 * Helper function to index a document asynchronously.
 *
 * This runs in the background after the upload response is sent.
 * In production, this would be a proper job queue (e.g., Bull, BullMQ).
 *
 * @param documentId - ID of the document to index
 * @param document - The document object
 * @param ragEngine - RAG engine for indexing
 * @param documentStorage - Storage for updating status
 */
async function indexDocumentAsync(
    documentId: string,
    document: { id: string; name: string; type: DocumentType; content: string },
    ragEngine: IRAGEngine,
    documentStorage: IDocumentStorage
): Promise<void> {
    try {
        console.log(`Indexing document: ${document.name}`);

        const chunkCount = await ragEngine.indexDocument({
            id: document.id,
            name: document.name,
            type: document.type,
            content: document.content,
            uploadedAt: new Date(),
            status: 'pending',
            chunkCount: 0,
        });

        await documentStorage.updateDocumentStatus(documentId, 'indexed', chunkCount);
        console.log(`Document indexed: ${document.name} (${chunkCount} chunks)`);
    } catch (error) {
        console.error(`Failed to index document ${document.name}:`, error);
        await documentStorage.updateDocumentStatus(documentId, 'error');
    }
}
