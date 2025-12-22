/**
 * Query Processor Service
 *
 * Handles query validation, context assembly, and response formatting.
 * This is a core component that sits between the API layer and the RAG engine.
 *
 * Key responsibilities:
 * - Validate user queries before processing (reject empty/whitespace)
 * - Assemble context from conversation history and relevant documents
 * - Format responses with proper markdown and source references
 */

import {
    ValidationResult,
    QueryContext,
    ChatMessage,
    ConversationSession,
    DocumentChunk,
} from '../../shared/types';

/**
 * Interface for session retrieval.
 *
 * Why use an interface here?
 * - Dependency Inversion Principle: High-level modules shouldn't depend on low-level modules
 * - Makes the query processor testable without needing actual storage
 * - Allows swapping storage implementations (file-based, database, etc.)
 *
 */
export interface SessionProvider {
    getSession(id: string): Promise<ConversationSession | null>;
}

/**
 * Interface for document retrieval (RAG).
 *
 * This abstracts the vector store and similarity search,
 * allowing the query processor to request relevant documents
 * without knowing how they're stored or searched.
 */
export interface DocumentProvider {
    searchRelevantChunks(query: string, limit: number): Promise<DocumentChunk[]>;
}

/**
 * Default system prompt for the Technical Assistant.
 *
 * Why define this as a constant?
 * - Single source of truth for the assistant's behavior
 * - Easy to modify and test
 * - Can be extended with dynamic context
 * 
 */
const DEFAULT_SYSTEM_PROMPT = `You are a helpful Technical Assistant designed to help junior engineers and interns with technical questions.

Your responsibilities:
- Provide accurate, clear technical explanations
- Include code examples when relevant, with proper syntax highlighting
- Reference source documents when available
- If you're uncertain about something, clearly indicate that and suggest consulting a senior engineer
- Be encouraging and supportive - remember your audience is learning

Guidelines:
- Format responses using Markdown for readability
- Use code blocks with language identifiers for code examples
- Break down complex concepts into digestible parts
- Provide context for why something works, not just how`;

/**
 * Configuration options for context assembly.
 */
export interface AssembleContextOptions {
    /** Maximum number of relevant document chunks to include */
    maxDocumentChunks?: number;
    /** Custom system prompt (overrides default) */
    customSystemPrompt?: string;
}

/**
 * Validates a user query before processing.
 *
 * Why this matters:
 * - Prevents unnecessary API calls to Ollama for invalid queries
 * - Provides immediate feedback to users
 * - Ensures consistent behavior across the application
 *
 * @param query - The user's input query string
 * @returns ValidationResult indicating if the query is valid
 */
export function validateQuery(query: string): ValidationResult {
    // Handle null/undefined gracefully (defensive programming)
    if (query === null || query === undefined) {
        return {
            valid: false,
            error: 'Query is required',
        };
    }

    // Check if query is empty or contains only whitespace
    // Using trim() handles spaces, tabs, newlines, and other whitespace chars
    const trimmedQuery = query.trim();

    if (trimmedQuery.length === 0) {
        return {
            valid: false,
            error: 'Query cannot be empty or contain only whitespace',
        };
    }

    // Query is valid
    return {
        valid: true,
    };
}

/**
 * Assembles the context needed for generating a response.
 *
 * This is the heart of the RAG (Retrieval-Augmented Generation) pipeline.
 * It gathers all the information the LLM needs to generate a good response:
 * 1. Conversation history - for context continuity
 * 2. Relevant documents - for grounding responses in team knowledge
 * 3. System prompt - for consistent assistant behavior
 *
 *
 * @param sessionId - The conversation session ID (optional for new conversations)
 * @param query - The user's current query
 * @param sessionProvider - Provider for retrieving session data
 * @param documentProvider - Provider for retrieving relevant documents (optional)
 * @param options - Configuration options for context assembly
 * @returns QueryContext with all assembled information
 */
export async function assembleContext(
    sessionId: string | undefined,
    query: string,
    sessionProvider: SessionProvider,
    documentProvider?: DocumentProvider,
    options: AssembleContextOptions = {}
): Promise<QueryContext> {
    const { maxDocumentChunks = 5, customSystemPrompt } = options;

    // Step 1: Retrieve conversation history
    // This maintains context across the conversation (Requirement 1.2)
    let conversationHistory: ChatMessage[] = [];

    if (sessionId) {
        const session = await sessionProvider.getSession(sessionId);
        if (session) {
            // Return messages in chronological order
            // This is important for the LLM to understand the conversation flow
            conversationHistory = [...session.messages];
        }
    }

    // Step 2: Retrieve relevant documents (if document provider is available)
    // This is the "Retrieval" part of RAG
    let relevantDocuments: DocumentChunk[] = [];

    if (documentProvider) {
        relevantDocuments = await documentProvider.searchRelevantChunks(
            query,
            maxDocumentChunks
        );
    }

    // Step 3: Build the system prompt
    // We can enhance the default prompt with context-specific information
    const systemPrompt = buildSystemPrompt(
        customSystemPrompt || DEFAULT_SYSTEM_PROMPT,
        relevantDocuments
    );

    return {
        conversationHistory,
        relevantDocuments,
        systemPrompt,
    };
}

/**
 * Builds the system prompt, optionally enhanced with document context.
 *
 * Why separate this function?
 * - Single Responsibility: System prompt construction is its own concern
 * - Testability: We can test prompt building independently
 * - Extensibility: Easy to add more context sources later
 *
 * @param basePrompt - The base system prompt
 * @param documents - Relevant document chunks to include
 * @returns The complete system prompt
 */
function buildSystemPrompt(
    basePrompt: string,
    documents: DocumentChunk[]
): string {
    if (documents.length === 0) {
        return basePrompt;
    }

    // Add document context to the system prompt
    // This tells the LLM what knowledge it has available
    const documentContext = documents
        .map(
            (doc, index) =>
                `[Source ${index + 1}: ${doc.metadata.documentName}]\n${doc.content}`
        )
        .join('\n\n');

    return `${basePrompt}

---
AVAILABLE KNOWLEDGE BASE CONTEXT:
The following excerpts from team documentation may be relevant to the user's question.
Reference these sources when applicable and cite them in your response.

${documentContext}
---`;
}

/**
 * Gets the default system prompt.
 * Exported for testing and customization purposes.
 */
export function getDefaultSystemPrompt(): string {
    return DEFAULT_SYSTEM_PROMPT;
}
