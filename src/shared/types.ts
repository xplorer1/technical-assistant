/**
 * Shared type definitions for the Technical Assistant
 *
 * These types define the contract between frontend and backend.
 * They're organized by domain:
 * - Chat: Messages and conversations
 * - Documents: Knowledge base content
 * - Sessions: Conversation persistence
 * - API: Request/response shapes
 */

// ============================================================================
// Chat Types
// ============================================================================

/**
 * Reference to a source document used in generating a response.
 * This enables users to verify information and explore further.
 */
export interface SourceReference {
    documentId: string;
    documentName: string;
    excerpt: string;
}

/**
 * A single message in a conversation.
 * Messages can be from the user or the assistant.
 */
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    sources?: SourceReference[];
}

/**
 * A conversation session containing multiple messages.
 * Sessions are persisted to allow users to continue past discussions.
 */
export interface ConversationSession {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    messages: ChatMessage[];
}

// ============================================================================
// Document Types
// ============================================================================

/**
 * Supported document formats for the knowledge base.
 * Each format requires a specific parser implementation.
 */
export type DocumentType = 'markdown' | 'text' | 'pdf';

/**
 * Processing status for uploaded documents.
 * - pending: Uploaded but not yet indexed
 * - indexed: Successfully processed and searchable
 * - error: Processing failed
 */
export type DocumentStatus = 'pending' | 'indexed' | 'error';

/**
 * A document in the knowledge base.
 * Documents are chunked and embedded for RAG retrieval.
 */
export interface Document {
    id: string;
    name: string;
    type: DocumentType;
    content: string;
    uploadedAt: Date;
    indexedAt?: Date;
    status: DocumentStatus;
    chunkCount: number;
}

/**
 * A chunk of a document with its embedding vector.
 * Chunks are the unit of retrieval in the RAG system.
 */
export interface DocumentChunk {
    id: string;
    documentId: string;
    content: string;
    embedding: number[];
    metadata: ChunkMetadata;
}

export interface ChunkMetadata {
    documentName: string;
    chunkIndex: number;
    section?: string;
}

// ============================================================================
// Vector Store Types
// ============================================================================

/**
 * Entry in the vector store for similarity search.
 */
export interface VectorEntry {
    id: string;
    documentId: string;
    chunkIndex: number;
    content: string;
    embedding: number[];
    metadata: {
        documentName: string;
        section?: string;
    };
}

// ============================================================================
// Query Processing Types
// ============================================================================

/**
 * Result of query validation.
 * Invalid queries are rejected before processing.
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Assembled context for generating a response.
 * Includes conversation history and relevant documents.
 */
export interface QueryContext {
    conversationHistory: ChatMessage[];
    relevantDocuments: DocumentChunk[];
    systemPrompt: string;
}

/**
 * Response from the RAG engine.
 * Includes confidence score for uncertainty handling.
 */
export interface RAGResponse {
    content: string;
    sources: SourceReference[];
    confidence: number;
}

// ============================================================================
// Ollama Client Types
// ============================================================================

/**
 * Options for text generation via Ollama.
 */
export interface GenerationOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

// ============================================================================
// Session Storage Types (JSON serialization)
// ============================================================================

/**
 * Session format for JSON persistence.
 * Dates are stored as ISO strings.
 */
export interface StoredSession {
    id: string;
    title: string;
    createdAt: string; // ISO date
    updatedAt: string; // ISO date
    messages: StoredMessage[];
}

/**
 * Message format for JSON persistence.
 */
export interface StoredMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string; // ISO date
    sources?: SourceReference[];
}

// ============================================================================
// API Types
// ============================================================================

/**
 * Request body for POST /api/chat
 */
export interface ChatRequest {
    sessionId?: string;
    message: string;
}

/**
 * Response body for POST /api/chat
 */
export interface ChatResponse {
    sessionId: string;
    response: ChatMessage;
}

/**
 * Response body for GET /api/health
 */
export interface HealthResponse {
    status: 'ok' | 'error';
    ollama: boolean;
}

/**
 * Response body for POST /api/documents
 */
export interface DocumentUploadResponse {
    documentId: string;
    status: DocumentStatus;
}
