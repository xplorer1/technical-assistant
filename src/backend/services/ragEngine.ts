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
 * INTERVIEW TALKING POINTS:
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
 * - similarityThreshold=0.3: Filter out clearly irrelevant results
 * - confidenceThreshold=0.5: Trigger uncertainty message when unsure
 * - maxContextTokens=2000: Leave room for query and response
 */
export const DEFAULT_RAG_CONFIG: RAGEngineConfig = {
  topK: 5,
  similarityThreshold: 0.3,
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
    return results
      .filter((r) => r.score >= this.config.similarityThreshold)
      .map((r) => this.vectorEntryToChunk(r));
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

    // System instructions
    parts.push(`You are a helpful technical assistant. Answer questions based on the provided context.
If the context doesn't contain relevant information, say so honestly.
Always cite your sources when using information from the context.
Format code examples with proper syntax highlighting using markdown code blocks.`);

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
      parts.push('\n(No relevant documentation found for this query)\n');
    }

    // Conversation history (last few messages for context)
    if (history.length > 0) {
      parts.push('--- CONVERSATION HISTORY ---');
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
