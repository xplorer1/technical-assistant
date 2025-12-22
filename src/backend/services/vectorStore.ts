/**
 * Vector Store Service
 *
 * In-memory vector store for semantic similarity search.
 *
 * WHY VECTOR STORES MATTER FOR RAG:
 * Traditional keyword search finds exact matches. Vector stores enable
 * semantic search - finding documents that are conceptually similar even
 * if they don't share exact words. This is the "Retrieval" in RAG.
 *
 * HOW IT WORKS:
 * 1. Documents are converted to embedding vectors (arrays of numbers)
 * 2. Query is also converted to an embedding vector
 * 3. We find documents whose vectors are "close" to the query vector
 * 4. Closeness is measured using cosine similarity
 *
 * INTERVIEW TALKING POINTS:
 * - Cosine similarity vs Euclidean distance (cosine is direction-based, better for text)
 * - Trade-offs of in-memory vs persistent vector stores (speed vs durability)
 * - Approximate nearest neighbor (ANN) algorithms for scale (we use exact search here)
 */

import { VectorEntry, DocumentChunk } from '../../shared/types';

/**
 * Result of a similarity search.
 */
export interface SearchResult {
  entry: VectorEntry;
  score: number; // Cosine similarity score (0 to 1, higher = more similar)
}

/**
 * Interface for vector store operations.
 * This abstraction allows swapping implementations (e.g., to a persistent store).
 */
export interface IVectorStore {
  add(entry: VectorEntry): void;
  addMany(entries: VectorEntry[]): void;
  search(queryEmbedding: number[], limit: number): SearchResult[];
  delete(id: string): boolean;
  deleteByDocumentId(documentId: string): number;
  get(id: string): VectorEntry | undefined;
  getByDocumentId(documentId: string): VectorEntry[];
  size(): number;
  clear(): void;
}

/**
 * Calculate cosine similarity between two vectors.
 *
 * Cosine similarity measures the angle between two vectors:
 * - 1.0 = identical direction (most similar)
 * - 0.0 = perpendicular (unrelated)
 * - -1.0 = opposite direction (least similar, rare in text embeddings)
 *
 * Formula: cos(θ) = (A · B) / (||A|| × ||B||)
 *
 * WHY COSINE OVER EUCLIDEAN:
 * Cosine similarity is magnitude-independent. Two documents about the same
 * topic will have similar directions even if one is longer (larger magnitude).
 * Euclidean distance would consider them different due to magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  if (a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    magnitudeA += aVal * aVal;
    magnitudeB += bVal * bVal;
  }

  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);

  // Handle zero vectors (avoid division by zero)
  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * In-memory Vector Store implementation.
 *
 * This is a simple, exact-search implementation suitable for:
 * - Small to medium document collections (< 10,000 chunks)
 * - Development and testing
 * - Applications where simplicity > performance
 *
 * For larger scale, you'd use:
 * - Approximate Nearest Neighbor (ANN) algorithms (HNSW, IVF)
 * - Dedicated vector databases (Pinecone, Weaviate, Milvus)
 * - PostgreSQL with pgvector extension
 */
export class InMemoryVectorStore implements IVectorStore {
  private entries: Map<string, VectorEntry> = new Map();
  private documentIndex: Map<string, Set<string>> = new Map(); // documentId -> entry IDs

  /**
   * Add a single entry to the store.
   */
  add(entry: VectorEntry): void {
    this.entries.set(entry.id, entry);

    // Update document index for efficient document-level operations
    if (!this.documentIndex.has(entry.documentId)) {
      this.documentIndex.set(entry.documentId, new Set());
    }
    this.documentIndex.get(entry.documentId)!.add(entry.id);
  }

  /**
   * Add multiple entries at once.
   * More efficient than calling add() repeatedly.
   */
  addMany(entries: VectorEntry[]): void {
    for (const entry of entries) {
      this.add(entry);
    }
  }

  /**
   * Search for entries most similar to the query embedding.
   *
   * This is a brute-force O(n) search - we compare the query to every
   * entry in the store. For small collections this is fine, but for
   * large collections you'd want an index structure.
   *
   * @param queryEmbedding - The embedding vector to search for
   * @param limit - Maximum number of results to return
   * @returns Array of results sorted by similarity (highest first)
   */
  search(queryEmbedding: number[], limit: number): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      results.push({ entry, score });
    }

    // Sort by score descending (most similar first)
    results.sort((a, b) => b.score - a.score);

    // Return top N results
    return results.slice(0, limit);
  }

  /**
   * Delete an entry by ID.
   * @returns true if entry was found and deleted
   */
  delete(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }

    this.entries.delete(id);

    // Update document index
    const docEntries = this.documentIndex.get(entry.documentId);
    if (docEntries) {
      docEntries.delete(id);
      if (docEntries.size === 0) {
        this.documentIndex.delete(entry.documentId);
      }
    }

    return true;
  }

  /**
   * Delete all entries for a document.
   * Used when a document is removed or re-indexed.
   *
   * @returns Number of entries deleted
   */
  deleteByDocumentId(documentId: string): number {
    const entryIds = this.documentIndex.get(documentId);
    if (!entryIds) {
      return 0;
    }

    let count = 0;
    for (const id of entryIds) {
      if (this.entries.delete(id)) {
        count++;
      }
    }

    this.documentIndex.delete(documentId);
    return count;
  }

  /**
   * Get an entry by ID.
   */
  get(id: string): VectorEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Get all entries for a document.
   */
  getByDocumentId(documentId: string): VectorEntry[] {
    const entryIds = this.documentIndex.get(documentId);
    if (!entryIds) {
      return [];
    }

    const entries: VectorEntry[] = [];
    for (const id of entryIds) {
      const entry = this.entries.get(id);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Get the total number of entries in the store.
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Clear all entries from the store.
   */
  clear(): void {
    this.entries.clear();
    this.documentIndex.clear();
  }
}

/**
 * Convert DocumentChunk to VectorEntry for storage.
 *
 * This is a mapping function between our domain types.
 * DocumentChunk is what we work with in the RAG pipeline,
 * VectorEntry is what we store in the vector store.
 */
export function chunkToVectorEntry(chunk: DocumentChunk): VectorEntry {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    chunkIndex: chunk.metadata.chunkIndex,
    content: chunk.content,
    embedding: chunk.embedding,
    metadata: {
      documentName: chunk.metadata.documentName,
      section: chunk.metadata.section,
    },
  };
}

/**
 * Factory function to create a vector store.
 */
export function createVectorStore(): IVectorStore {
  return new InMemoryVectorStore();
}
