/**
 * Unit tests for Query Processor
 *
 * Tests the validateQuery function to ensure it correctly:
 * - Accepts valid queries
 * - Rejects empty strings
 * - Rejects whitespace-only strings
 *
 * Tests the assembleContext function to ensure it correctly:
 * - Gathers conversation history from sessions
 * - Builds system prompts with relevant context
 * - Handles missing sessions gracefully
 */

import {
    validateQuery,
    assembleContext,
    getDefaultSystemPrompt,
    SessionProvider,
    DocumentProvider,
} from '../queryProcessor';
import {
    ConversationSession,
    ChatMessage,
    DocumentChunk,
} from '../../../shared/types';
import * as fc from 'fast-check';

describe('validateQuery', () => {
    describe('valid queries', () => {
        it('should accept a simple text query', () => {
            const result = validateQuery('What is TypeScript?');
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should accept a query with leading/trailing spaces (content exists)', () => {
            const result = validateQuery('  How do I use React?  ');
            expect(result.valid).toBe(true);
        });

        it('should accept a single character query', () => {
            const result = validateQuery('?');
            expect(result.valid).toBe(true);
        });
    });

    describe('invalid queries - empty', () => {
        it('should reject an empty string', () => {
            const result = validateQuery('');
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('invalid queries - whitespace only', () => {
        it('should reject a string with only spaces', () => {
            const result = validateQuery('   ');
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should reject a string with only tabs', () => {
            const result = validateQuery('\t\t');
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should reject a string with only newlines', () => {
            const result = validateQuery('\n\n');
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should reject a string with mixed whitespace', () => {
            const result = validateQuery(' \t \n ');
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });
    });
});


/**
 * Property-Based Tests for Query Processor
 *
 * These tests verify correctness properties that should hold across ALL inputs,
 * not just specific examples. This is powerful for catching edge cases we might
 * not think of manually.
 *
 * Interview insight: Property-based testing (PBT) is a testing approach where
 * instead of writing specific test cases, you define properties that should
 * always be true, and the framework generates hundreds of random inputs to
 * verify those properties. Libraries like fast-check, QuickCheck (Haskell),
 * and Hypothesis (Python) implement this approach.
 */
describe('Property-Based Tests', () => {
    /**
     * **Feature: technical-assistant, Property 1: Whitespace query rejection**
     * **Validates: Requirements 1.3**
     *
     * Property: For ANY string composed entirely of whitespace characters
     * (spaces, tabs, newlines, etc.), the validation SHALL reject it.
     *
     * Why this matters:
     * - Ensures we don't accidentally process empty queries
     * - Prevents wasted Ollama API calls
     * - Provides consistent UX regardless of how users create "empty" input
     *
     * How fast-check helps:
     * - Generates hundreds of whitespace-only strings we'd never think to test
     * - Includes edge cases like Unicode whitespace characters
     * - If it finds a failure, it "shrinks" to the minimal failing case
     */
    describe('Property 1: Whitespace query rejection', () => {
        // Custom arbitrary that generates strings containing ONLY whitespace
        // This includes: spaces, tabs, newlines, carriage returns, etc.
        const whitespaceOnlyString = fc.stringOf(
            fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v')
        );

        it('should reject any string composed entirely of whitespace', () => {
            fc.assert(
                fc.property(whitespaceOnlyString, (whitespaceQuery) => {
                    const result = validateQuery(whitespaceQuery);

                    // The property: whitespace-only strings must be rejected
                    expect(result.valid).toBe(false);
                    expect(result.error).toBeDefined();
                }),
                { numRuns: 100 } // Run 100 iterations as specified in design doc
            );
        });

        /**
         * Complementary property: Valid queries (with non-whitespace content)
         * should be accepted.
         *
         * This ensures we're not being too aggressive with rejection.
         */
        it('should accept any string that contains at least one non-whitespace character', () => {
            // Generate strings that have at least one non-whitespace character
            const nonEmptyQuery = fc
                .string({ minLength: 1 })
                .filter((s) => s.trim().length > 0);

            fc.assert(
                fc.property(nonEmptyQuery, (validQuery) => {
                    const result = validateQuery(validQuery);

                    // The property: queries with content must be accepted
                    expect(result.valid).toBe(true);
                    expect(result.error).toBeUndefined();
                }),
                { numRuns: 100 }
            );
        });
    });
});

/**
 * Unit Tests for assembleContext
 *
 * These tests verify the context assembly functionality:
 * - Retrieving conversation history from sessions
 * - Building system prompts with document context
 * - Handling edge cases (missing sessions, no documents)
 *
 * Interview insight: Context assembly is critical in RAG systems.
 * The quality of the assembled context directly impacts response quality.
 * Key considerations include:
 * - Token limits (can't send infinite context)
 * - Relevance ranking (most relevant docs first)
 * - Conversation continuity (maintaining chat flow)
 */
describe('assembleContext', () => {
    // Helper to create mock messages
    const createMessage = (
        role: 'user' | 'assistant',
        content: string,
        id?: string
    ): ChatMessage => ({
        id: id || `msg-${Date.now()}-${Math.random()}`,
        role,
        content,
        timestamp: new Date(),
    });

    // Helper to create mock sessions
    const createSession = (
        messages: ChatMessage[],
        id?: string
    ): ConversationSession => ({
        id: id || `session-${Date.now()}`,
        title: 'Test Session',
        createdAt: new Date(),
        updatedAt: new Date(),
        messages,
    });

    // Helper to create mock document chunks
    const createDocumentChunk = (
        content: string,
        documentName: string
    ): DocumentChunk => ({
        id: `chunk-${Date.now()}-${Math.random()}`,
        documentId: `doc-${Date.now()}`,
        content,
        embedding: [],
        metadata: {
            documentName,
            chunkIndex: 0,
        },
    });

    describe('conversation history retrieval', () => {
        it('should return empty history for new conversations (no sessionId)', async () => {
            const mockSessionProvider: SessionProvider = {
                getSession: jest.fn().mockResolvedValue(null),
            };

            const result = await assembleContext(
                undefined,
                'What is TypeScript?',
                mockSessionProvider
            );

            expect(result.conversationHistory).toEqual([]);
            expect(mockSessionProvider.getSession).not.toHaveBeenCalled();
        });

        it('should return empty history when session is not found', async () => {
            const mockSessionProvider: SessionProvider = {
                getSession: jest.fn().mockResolvedValue(null),
            };

            const result = await assembleContext(
                'non-existent-session',
                'What is TypeScript?',
                mockSessionProvider
            );

            expect(result.conversationHistory).toEqual([]);
            expect(mockSessionProvider.getSession).toHaveBeenCalledWith(
                'non-existent-session'
            );
        });

        it('should return conversation history in chronological order', async () => {
            const messages = [
                createMessage('user', 'Hello'),
                createMessage('assistant', 'Hi! How can I help?'),
                createMessage('user', 'What is React?'),
            ];
            const session = createSession(messages, 'test-session');

            const mockSessionProvider: SessionProvider = {
                getSession: jest.fn().mockResolvedValue(session),
            };

            const result = await assembleContext(
                'test-session',
                'Follow up question',
                mockSessionProvider
            );

            expect(result.conversationHistory).toHaveLength(3);
            expect(result.conversationHistory[0].content).toBe('Hello');
            expect(result.conversationHistory[1].content).toBe(
                'Hi! How can I help?'
            );
            expect(result.conversationHistory[2].content).toBe('What is React?');
        });
    });

    describe('system prompt building', () => {
        it('should return default system prompt when no documents are provided', async () => {
            const mockSessionProvider: SessionProvider = {
                getSession: jest.fn().mockResolvedValue(null),
            };

            const result = await assembleContext(
                undefined,
                'What is TypeScript?',
                mockSessionProvider
            );

            expect(result.systemPrompt).toBe(getDefaultSystemPrompt());
        });

        it('should include document context in system prompt when documents are available', async () => {
            const mockSessionProvider: SessionProvider = {
                getSession: jest.fn().mockResolvedValue(null),
            };

            const mockDocumentProvider: DocumentProvider = {
                searchRelevantChunks: jest.fn().mockResolvedValue([
                    createDocumentChunk(
                        'TypeScript is a typed superset of JavaScript.',
                        'typescript-guide.md'
                    ),
                ]),
            };

            const result = await assembleContext(
                undefined,
                'What is TypeScript?',
                mockSessionProvider,
                mockDocumentProvider
            );

            expect(result.systemPrompt).toContain(getDefaultSystemPrompt());
            expect(result.systemPrompt).toContain('AVAILABLE KNOWLEDGE BASE CONTEXT');
            expect(result.systemPrompt).toContain('typescript-guide.md');
            expect(result.systemPrompt).toContain(
                'TypeScript is a typed superset of JavaScript.'
            );
        });

        it('should allow custom system prompt override', async () => {
            const mockSessionProvider: SessionProvider = {
                getSession: jest.fn().mockResolvedValue(null),
            };

            const customPrompt = 'You are a specialized Python assistant.';

            const result = await assembleContext(
                undefined,
                'What is Python?',
                mockSessionProvider,
                undefined,
                { customSystemPrompt: customPrompt }
            );

            expect(result.systemPrompt).toBe(customPrompt);
            expect(result.systemPrompt).not.toContain(getDefaultSystemPrompt());
        });
    });

    describe('document retrieval', () => {
        it('should return empty documents when no document provider is given', async () => {
            const mockSessionProvider: SessionProvider = {
                getSession: jest.fn().mockResolvedValue(null),
            };

            const result = await assembleContext(
                undefined,
                'What is TypeScript?',
                mockSessionProvider
            );

            expect(result.relevantDocuments).toEqual([]);
        });

        it('should retrieve relevant documents with default limit', async () => {
            const mockSessionProvider: SessionProvider = {
                getSession: jest.fn().mockResolvedValue(null),
            };

            const mockDocumentProvider: DocumentProvider = {
                searchRelevantChunks: jest.fn().mockResolvedValue([
                    createDocumentChunk('Content 1', 'doc1.md'),
                    createDocumentChunk('Content 2', 'doc2.md'),
                ]),
            };

            const result = await assembleContext(
                undefined,
                'What is TypeScript?',
                mockSessionProvider,
                mockDocumentProvider
            );

            expect(mockDocumentProvider.searchRelevantChunks).toHaveBeenCalledWith(
                'What is TypeScript?',
                5 // default maxDocumentChunks
            );
            expect(result.relevantDocuments).toHaveLength(2);
        });

        it('should respect custom maxDocumentChunks option', async () => {
            const mockSessionProvider: SessionProvider = {
                getSession: jest.fn().mockResolvedValue(null),
            };

            const mockDocumentProvider: DocumentProvider = {
                searchRelevantChunks: jest.fn().mockResolvedValue([]),
            };

            await assembleContext(
                undefined,
                'What is TypeScript?',
                mockSessionProvider,
                mockDocumentProvider,
                { maxDocumentChunks: 10 }
            );

            expect(mockDocumentProvider.searchRelevantChunks).toHaveBeenCalledWith(
                'What is TypeScript?',
                10
            );
        });
    });
});
