/**
 * RAG Engine Service
 *
 * Retrieval-Augmented Generation (RAG) combines retrieval and generation:
 * 1. RETRIEVE: Find relevant documents for the user's query
 * 2. AUGMENT: Add retrieved context to the prompt
 * 3. GENERATE: Use LLM to generate a response with the augmented context
 *
 * WHY RAG MATTERS:
 * LLMs have knowledge cutoffs and can hallucinate. RAG grounds responses
 * in actual documents, improving accuracy and enabling domain-specific answers.
 *
 * - RAG vs fine-tuning (RAG is cheaper, more flexible, easier to update)
 * - Retrieval quality directly impacts generation quality
 * - Confidence scoring helps identify when the model is uncertain
 * - Source attribution builds trust and enables verification
 */

import {
  Document,
  DocumentChunk,
  RAGResponse,
  SourceReference,
  ChatMessage,
} from '../../shared/types';
import { IOllamaClient } from '../clients/ollamaClient';
import { IVectorStore, SearchResult, chunkToVectorEntry } from './vectorStore';
import { DocumentChunker, createDocumentChunker } from './documentChunker';
import { parseDocument } from './documentParser';

/**
 * Configuration for the RAG engine.
 */
export interface RAGEngineConfig {
  /** Number of chunks to retrieve for context */
  topK: number;
  /** Minimum similarity score to include a chunk (0-1) */
  similarityThreshold: number;
  /** Confidence threshold below which to indicate uncertainty */
  confidenceThreshold: number;
  /** Maximum tokens for context (to avoid exceeding model limits) */
  maxContextTokens: number;
}

/**
 * Default RAG configuration.
 *
 * WHY THESE VALUES:
 * - topK=5: Balance between context richness and noise
 * - similarityThreshold=0.35: Lower threshold to catch relevant docs, rely on prompt to prevent hallucination
 * - confidenceThreshold=0.5: Trigger uncertainty message when unsure
 * - maxContextTokens=2000: Leave room for query and response
 */
export const DEFAULT_RAG_CONFIG: RAGEngineConfig = {
  topK: 5,
  similarityThreshold: 0.35,  // Lowered to catch more relevant results
  confidenceThreshold: 0.5,
  maxContextTokens: 2000,
};

/**
 * Interface for the RAG engine.
 */
export interface IRAGEngine {
  indexDocument(document: Document): Promise<number>;
  removeDocument(documentId: string): number;
  searchRelevantChunks(query: string, limit?: number): Promise<DocumentChunk[]>;
  generateResponse(
    query: string,
    conversationHistory?: ChatMessage[]
  ): Promise<RAGResponse>;
}

/**
 * RAG Engine implementation.
 *
 * This is the core component that ties together:
 * - Document parsing and chunking
 * - Vector storage and retrieval
 * - LLM response generation
 */
export class RAGEngine implements IRAGEngine {
  private readonly ollamaClient: IOllamaClient;
  private readonly vectorStore: IVectorStore;
  private readonly chunker: DocumentChunker;
  private readonly config: RAGEngineConfig;

  constructor(
    ollamaClient: IOllamaClient,
    vectorStore: IVectorStore,
    config: Partial<RAGEngineConfig> = {}
  ) {
    this.ollamaClient = ollamaClient;
    this.vectorStore = vectorStore;
    this.chunker = createDocumentChunker(ollamaClient);
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };
  }

  /**
   * Index a document for retrieval.
   *
   * This is the "ingestion" phase of RAG:
   * 1. Parse the document to extract text
   * 2. Split into chunks
   * 3. Generate embeddings for each chunk
   * 4. Store in vector store
   *
   * @param document - The document to index
   * @returns Number of chunks created
   */
  async indexDocument(document: Document): Promise<number> {
    // Remove existing chunks for this document (for re-indexing)
    this.vectorStore.deleteByDocumentId(document.id);

    // Parse the document
    const parseResult = await parseDocument(document.type, document.content);

    // Chunk and embed
    const chunks = await this.chunker.chunkDocument({
      documentId: document.id,
      documentName: document.name,
      content: parseResult.content,
      sections: parseResult.metadata.sections,
    });

    // Store in vector store
    for (const chunk of chunks) {
      this.vectorStore.add(chunkToVectorEntry(chunk));
    }

    return chunks.length;
  }

  /**
   * Remove a document from the index.
   *
   * @param documentId - ID of the document to remove
   * @returns Number of chunks removed
   */
  removeDocument(documentId: string): number {
    return this.vectorStore.deleteByDocumentId(documentId);
  }

  /**
   * Search for chunks relevant to a query.
   *
   * This is the "retrieval" phase of RAG.
   * We embed the query and find similar chunks in the vector store.
   *
   * @param query - The search query
   * @param limit - Maximum number of chunks to return
   * @returns Array of relevant document chunks
   */
  async searchRelevantChunks(
    query: string,
    limit: number = this.config.topK
  ): Promise<DocumentChunk[]> {
    // Generate embedding for the query
    const queryEmbedding = await this.ollamaClient.generateEmbedding(query);

    // Search vector store
    const results = this.vectorStore.search(queryEmbedding, limit);

    // Filter by similarity threshold and convert to DocumentChunk
    const chunks = results
      .filter((r) => r.score >= this.config.similarityThreshold)
      .map((r) => this.vectorEntryToChunk(r));

    // Extract potential project/topic names from the query
    // This helps validate that retrieved chunks are actually about what the user asked
    const queryTopics = this.extractTopicsFromQuery(query);
    
    // If the user mentioned a specific project name, filter chunks to those that
    // either mention that project or come from a document with that name
    if (queryTopics.length > 0) {
      const filteredChunks = chunks.filter((chunk) => {
        const docNameLower = chunk.metadata.documentName.toLowerCase();
        const contentLower = chunk.content.toLowerCase();
        
        // Check if any query topic matches the document name or content
        return queryTopics.some((topic) => 
          docNameLower.includes(topic) || contentLower.includes(topic)
        );
      });
      
      // If we found topic-specific chunks, use those; otherwise fall back to all chunks
      // This prevents returning innx-be docs when asking about nebvla
      if (filteredChunks.length > 0) {
        return filteredChunks;
      }
      
      // If no chunks match the specific topic, return empty to trigger "I don't know"
      // This is the key to preventing hallucination about unknown projects
      return [];
    }

    return chunks;
  }

  /**
   * Extract potential project/topic names from a query.
   * 
   * This is a simple heuristic that looks for words that might be project names.
   * In production, you might use NER (Named Entity Recognition) for this.
   */
  private extractTopicsFromQuery(query: string): string[] {
    const queryLower = query.toLowerCase();
    
    // Common question patterns to remove
    const patterns = [
      /how (do|can|to) (i |you )?(set up|install|configure|use|run|start)/gi,
      /what is/gi,
      /tell me about/gi,
      /explain/gi,
      /help with/gi,
    ];
    
    let cleaned = queryLower;
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }
    
    // Remove common words and punctuation
    const stopWords = ['the', 'a', 'an', 'on', 'my', 'computer', 'machine', 'system', 'please', 'can', 'you', 'i', 'me', 'how', 'what', 'where', 'when', 'why', 'is', 'are', 'do', 'does', 'to', 'for', 'with', 'and', 'or', 'in', 'it', 'this', 'that'];
    
    const words = cleaned
      .replace(/[?.,!]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.includes(word));
    
    return words;
  }

  /**
   * Generate a response using RAG.
   *
   * This is the full RAG pipeline:
   * 1. Retrieve relevant chunks
   * 2. Build prompt with context
   * 3. Generate response via LLM
   * 4. Calculate confidence and add source references
   *
   * @param query - The user's question
   * @param conversationHistory - Previous messages for context
   * @returns RAG response with content, sources, and confidence
   */
  async generateResponse(
    query: string,
    conversationHistory: ChatMessage[] = []
  ): Promise<RAGResponse> {
    // Step 1: Retrieve relevant chunks
    const relevantChunks = await this.searchRelevantChunks(query);

    // Step 2: Build the prompt
    const prompt = this.buildPrompt(query, relevantChunks, conversationHistory);

    // Step 3: Generate response
    const rawResponse = await this.ollamaClient.generateCompletion(prompt, {
      temperature: 0.7,
      maxTokens: 1024,
    });

    // Step 4: Calculate confidence based on retrieval quality
    const confidence = this.calculateConfidence(relevantChunks);

    // Step 5: Build source references
    const sources = this.buildSourceReferences(relevantChunks);

    // Step 6: Add uncertainty indicator if confidence is low
    let content = rawResponse;
    if (confidence < this.config.confidenceThreshold) {
      content = this.addUncertaintyIndicator(content);
    }

    return {
      content,
      sources,
      confidence,
    };
  }

  /**
   * Build the prompt for the LLM.
   *
   * The prompt structure is crucial for good RAG performance:
   * 1. System instructions (how to behave)
   * 2. Retrieved context (what to reference)
   * 3. Conversation history (for continuity)
   * 4. Current query (what to answer)
   */
  private buildPrompt(
    query: string,
    chunks: DocumentChunk[],
    history: ChatMessage[]
  ): string {
    const parts: string[] = [];

    // System instructions - CRITICAL for preventing hallucination
    parts.push(`You are a helpful technical assistant that ONLY answers questions based on the provided context.

IMPORTANT RULES:
1. ONLY use information from the CONTEXT section below to answer questions.
2. If the context does NOT contain information about what the user is asking, you MUST say: "I don't have information about [topic] in my knowledge base."
3. DO NOT make up information, guess, or use general knowledge not in the context.
4. DO NOT substitute one project's information for another project.
5. If asked about a project or topic not in the context, clearly state you don't have documentation for it.
6. The CONVERSATION HISTORY is ONLY for understanding what was discussed before - DO NOT use previous answers as facts for new questions.
7. If the user asks about a NEW topic not in the current CONTEXT, you must search the knowledge base fresh - do not reuse answers from history.
8. Always cite your sources when using information from the context.
9. Format code examples with proper syntax highlighting using markdown code blocks.

Remember: It's better to say "I don't know" than to provide incorrect information.`);

    // Retrieved context
    if (chunks.length > 0) {
      parts.push('\n--- CONTEXT FROM DOCUMENTATION ---');
      for (const chunk of chunks) {
        const source = chunk.metadata.section
          ? `[${chunk.metadata.documentName} - ${chunk.metadata.section}]`
          : `[${chunk.metadata.documentName}]`;
        parts.push(`\n${source}:\n${chunk.content}`);
      }
      parts.push('\n--- END CONTEXT ---\n');
    } else {
      parts.push('\n--- NO RELEVANT DOCUMENTATION FOUND ---');
      parts.push('There is no documentation in the knowledge base that matches this query.');
      parts.push('You must tell the user you do not have information about this topic.');
      parts.push('--- END ---\n');
    }

    // Conversation history (last few messages for context)
    // NOTE: History is for conversational continuity, NOT as a source of facts
    if (history.length > 0) {
      parts.push('--- CONVERSATION HISTORY (for reference only) ---');
      parts.push('NOTE: The conversation history below is ONLY for understanding the flow of conversation.');
      parts.push('DO NOT use information from previous answers to answer new questions about different topics.');
      parts.push('Each new question must be answered ONLY from the CONTEXT section above.\n');
      const recentHistory = history.slice(-6); // Last 3 exchanges
      for (const msg of recentHistory) {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        parts.push(`${role}: ${msg.content}`);
      }
      parts.push('--- END HISTORY ---\n');
    }

    // Current query
    parts.push(`User: ${query}`);
    parts.push('\nAssistant:');

    return parts.join('\n');
  }

  /**
   * Calculate confidence score based on retrieval quality.
   *
   * Confidence is based on:
   * - Whether we found any relevant chunks
   * - How similar the best matches are
   *
   * This is a heuristic - more sophisticated approaches might use
   * the LLM's own confidence or analyze the response.
   */
  private calculateConfidence(chunks: DocumentChunk[]): number {
    if (chunks.length === 0) {
      return 0.1; // Very low confidence with no context
    }

    // We don't have scores on chunks directly, so estimate based on count
    // More chunks found = higher confidence (up to a point)
    const countFactor = Math.min(chunks.length / this.config.topK, 1);

    // Base confidence when we have context
    return 0.4 + countFactor * 0.5; // Range: 0.4 to 0.9
  }

  /**
   * Build source references from retrieved chunks.
   *
   * Source references enable users to:
   * - Verify the information
   * - Explore the original documentation
   * - Understand where answers come from
   */
  private buildSourceReferences(chunks: DocumentChunk[]): SourceReference[] {
    // Deduplicate by document (don't list same doc multiple times)
    const seenDocs = new Set<string>();
    const sources: SourceReference[] = [];

    for (const chunk of chunks) {
      if (!seenDocs.has(chunk.documentId)) {
        seenDocs.add(chunk.documentId);
        sources.push({
          documentId: chunk.documentId,
          documentName: chunk.metadata.documentName,
          excerpt: this.truncateExcerpt(chunk.content, 100),
        });
      }
    }

    return sources;
  }

  /**
   * Add uncertainty indicator to response.
   *
   * When confidence is low, we want to:
   * 1. Be transparent about uncertainty
   * 2. Suggest consulting a senior engineer (per requirements)
   */
  private addUncertaintyIndicator(content: string): string {
    const indicator = `\n\n---\n⚠️ **Note:** I'm not fully confident in this answer based on the available documentation. Consider consulting a senior engineer for verification.`;
    return content + indicator;
  }

  /**
   * Truncate text for excerpt display.
   */
  private truncateExcerpt(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, maxLength - 3) + '...';
  }

  /**
   * Convert VectorEntry search result back to DocumentChunk.
   */
  private vectorEntryToChunk(result: SearchResult): DocumentChunk {
    const entry = result.entry;
    return {
      id: entry.id,
      documentId: entry.documentId,
      content: entry.content,
      embedding: entry.embedding,
      metadata: {
        documentName: entry.metadata.documentName,
        chunkIndex: entry.chunkIndex,
        section: entry.metadata.section,
      },
    };
  }
}

/**
 * Factory function to create a RAG engine.
 */
export function createRAGEngine(
  ollamaClient: IOllamaClient,
  vectorStore: IVectorStore,
  config?: Partial<RAGEngineConfig>
): RAGEngine {
  return new RAGEngine(ollamaClient, vectorStore, config);
}
