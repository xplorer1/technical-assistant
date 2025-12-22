/**
 * Backend services
 *
 * Core business logic components:
 * - QueryProcessor: Validates queries, assembles context, formats responses
 * - RAGEngine: Retrieval-Augmented Generation for knowledge base integration
 * - SessionManager: Manages conversation sessions and persistence
 */

export {
    validateQuery,
    assembleContext,
    getDefaultSystemPrompt,
} from './queryProcessor';

export type {
    SessionProvider,
    DocumentProvider,
    AssembleContextOptions,
} from './queryProcessor';

export { SessionManager, createSessionManager } from './sessionManager';

export type { SessionManagerConfig } from './sessionManager';

export {
    MarkdownParser,
    PlainTextParser,
    PdfParser,
    getParser,
    parseDocument,
    detectDocumentType,
} from './documentParser';

export type { ParseResult, DocumentParser } from './documentParser';

export {
    DocumentChunker,
    createDocumentChunker,
    splitIntoChunks,
    DEFAULT_CHUNKING_CONFIG,
} from './documentChunker';

export type { ChunkingConfig, ChunkInput, TextChunk } from './documentChunker';

export {
    InMemoryVectorStore,
    createVectorStore,
    cosineSimilarity,
    chunkToVectorEntry,
} from './vectorStore';

export type { IVectorStore, SearchResult } from './vectorStore';

export {
    RAGEngine,
    createRAGEngine,
    DEFAULT_RAG_CONFIG,
} from './ragEngine';

export type { RAGEngineConfig, IRAGEngine } from './ragEngine';

export {
    ResponseFormatter,
    createResponseFormatter,
    formatResponse,
    extractCodeBlocks,
    normalizeLanguage,
    containsLists,
    ensureCodeBlockLanguages,
    formatSourceReferences,
    createAssistantMessage,
    DEFAULT_FORMATTER_CONFIG,
} from './responseFormatter';

export type {
    CodeBlock,
    FormattedResponse,
    FormatterConfig,
    IResponseFormatter,
} from './responseFormatter';

export {
    DocumentStorage,
    createDocumentStorage,
} from './documentStorage';

export type {
    DocumentStorageConfig,
    IDocumentStorage,
} from './documentStorage';
