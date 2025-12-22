/**
 * Document Chunker Service
 *
 * Splits documents into smaller chunks for embedding and retrieval.
 *
 * WHY CHUNKING MATTERS FOR RAG:
 * LLMs have context limits, and embeddings work best on focused text.
 * Large documents must be split into chunks that:
 * 1. Fit within embedding model limits
 * 2. Contain coherent, self-contained information
 * 3. Overlap slightly to preserve context at boundaries
 *
 * INTERVIEW TALKING POINTS:
 * - Chunk size trade-off: Too small = lost context, too large = diluted relevance
 * - Overlap prevents information loss at chunk boundaries
 * - Semantic chunking (by paragraphs/sections) vs fixed-size chunking
 */

import { v4 as uuidv4 } from 'uuid';
import { DocumentChunk, ChunkMetadata } from '../../shared/types';
import { IOllamaClient } from '../clients/ollamaClient';

/**
 * Configuration for the chunking process.
 */
export interface ChunkingConfig {
  /** Target size for each chunk in characters */
  chunkSize: number;
  /** Number of characters to overlap between chunks */
  chunkOverlap: number;
  /** Minimum chunk size (chunks smaller than this are merged) */
  minChunkSize: number;
}

/**
 * Default chunking configuration.
 *
 * WHY THESE VALUES:
 * - 1000 chars ≈ 200-250 tokens, fits well in most embedding models
 * - 200 char overlap preserves context across chunk boundaries
 * - 100 char minimum prevents tiny, meaningless chunks
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  chunkSize: 1000,
  chunkOverlap: 200,
  minChunkSize: 100,
};

/**
 * Input for chunking a document.
 */
export interface ChunkInput {
  documentId: string;
  documentName: string;
  content: string;
  sections?: string[];
}

/**
 * Result of chunking without embeddings.
 * Used as intermediate step before embedding generation.
 */
export interface TextChunk {
  content: string;
  chunkIndex: number;
  section?: string;
}

/**
 * Splits text into overlapping chunks.
 *
 * This is a "sliding window" approach:
 * 1. Start at position 0
 * 2. Take chunkSize characters
 * 3. Move forward by (chunkSize - overlap) characters
 * 4. Repeat until end of text
 *
 * The overlap ensures that information spanning chunk boundaries
 * appears in at least one chunk completely.
 */
export function splitIntoChunks(
  text: string,
  config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG
): TextChunk[] {
  const { chunkSize, chunkOverlap, minChunkSize } = config;

  // Handle edge cases
  if (!text || text.trim().length === 0) {
    return [];
  }

  // If text is smaller than chunk size, return as single chunk
  if (text.length <= chunkSize) {
    return [{ content: text.trim(), chunkIndex: 0 }];
  }

  const chunks: TextChunk[] = [];
  let position = 0;
  let chunkIndex = 0;

  while (position < text.length) {
    // Calculate end position for this chunk
    let end = Math.min(position + chunkSize, text.length);

    // Try to break at a natural boundary (paragraph, sentence, word)
    if (end < text.length) {
      end = findNaturalBreak(text, position, end);
    }

    const chunkContent = text.slice(position, end).trim();

    // Only add chunk if it meets minimum size
    if (chunkContent.length >= minChunkSize) {
      chunks.push({
        content: chunkContent,
        chunkIndex,
      });
      chunkIndex++;
    }

    // Move position forward, accounting for overlap
    const step = Math.max(1, end - position - chunkOverlap);
    position += step;

    // Prevent infinite loop if we're not making progress
    if (position <= chunks.length * (chunkSize - chunkOverlap) - chunkSize) {
      position = end;
    }
  }

  return chunks;
}

/**
 * Find a natural break point near the target position.
 *
 * Preference order:
 * 1. Paragraph break (double newline)
 * 2. Sentence end (. ! ?)
 * 3. Word boundary (space)
 * 4. Original position (if no better option)
 *
 * This improves chunk quality by avoiding mid-word or mid-sentence breaks.
 */
function findNaturalBreak(text: string, start: number, targetEnd: number): number {
  const searchWindow = text.slice(start, targetEnd);

  // Look for paragraph break (prefer this most)
  const paragraphBreak = searchWindow.lastIndexOf('\n\n');
  if (paragraphBreak > searchWindow.length * 0.5) {
    return start + paragraphBreak + 2;
  }

  // Look for sentence end
  const sentenceEndMatch = searchWindow.match(/[.!?]\s+(?=[A-Z])/g);
  if (sentenceEndMatch && sentenceEndMatch.length > 0) {
    const lastMatch = sentenceEndMatch[sentenceEndMatch.length - 1];
    if (lastMatch) {
      const lastSentenceEnd = searchWindow.lastIndexOf(lastMatch);
      if (lastSentenceEnd > searchWindow.length * 0.5) {
        return start + lastSentenceEnd + lastMatch.length;
      }
    }
  }

  // Look for word boundary
  const lastSpace = searchWindow.lastIndexOf(' ');
  if (lastSpace > searchWindow.length * 0.7) {
    return start + lastSpace + 1;
  }

  // Fall back to original position
  return targetEnd;
}

/**
 * Assigns sections to chunks based on document structure.
 *
 * If the document has section headers, we track which section
 * each chunk belongs to. This metadata helps with:
 * 1. Better source references ("from section: Getting Started")
 * 2. Potential section-based filtering in search
 */
function assignSectionsToChunks(
  chunks: TextChunk[],
  content: string,
  sections?: string[]
): TextChunk[] {
  if (!sections || sections.length === 0) {
    return chunks;
  }

  // Find positions of each section in the content
  const sectionPositions: { section: string; position: number }[] = [];
  for (const section of sections) {
    const position = content.indexOf(section);
    if (position !== -1) {
      sectionPositions.push({ section, position });
    }
  }

  // Sort by position
  sectionPositions.sort((a, b) => a.position - b.position);

  // Assign sections to chunks based on position
  return chunks.map((chunk) => {
    const chunkPosition = content.indexOf(chunk.content);
    let currentSection: string | undefined;

    for (const { section, position } of sectionPositions) {
      if (position <= chunkPosition) {
        currentSection = section;
      } else {
        break;
      }
    }

    return {
      ...chunk,
      section: currentSection,
    };
  });
}

/**
 * Document Chunker class that handles the full chunking pipeline.
 *
 * Responsibilities:
 * 1. Split document into text chunks
 * 2. Generate embeddings for each chunk via Ollama
 * 3. Return DocumentChunk objects ready for vector store
 */
export class DocumentChunker {
  private readonly ollamaClient: IOllamaClient;
  private readonly config: ChunkingConfig;

  constructor(ollamaClient: IOllamaClient, config: Partial<ChunkingConfig> = {}) {
    this.ollamaClient = ollamaClient;
    this.config = { ...DEFAULT_CHUNKING_CONFIG, ...config };
  }

  /**
   * Chunk a document and generate embeddings for each chunk.
   *
   * This is the main entry point for document processing.
   * It combines text chunking with embedding generation.
   *
   * @param input - Document content and metadata
   * @returns Array of DocumentChunk objects with embeddings
   */
  async chunkDocument(input: ChunkInput): Promise<DocumentChunk[]> {
    const { documentId, documentName, content, sections } = input;

    // Step 1: Split into text chunks
    let textChunks = splitIntoChunks(content, this.config);

    // Step 2: Assign sections if available
    textChunks = assignSectionsToChunks(textChunks, content, sections);

    // Step 3: Generate embeddings for each chunk
    const documentChunks: DocumentChunk[] = [];

    for (const textChunk of textChunks) {
      const embedding = await this.ollamaClient.generateEmbedding(textChunk.content);

      const metadata: ChunkMetadata = {
        documentName,
        chunkIndex: textChunk.chunkIndex,
        section: textChunk.section,
      };

      documentChunks.push({
        id: uuidv4(),
        documentId,
        content: textChunk.content,
        embedding,
        metadata,
      });
    }

    return documentChunks;
  }

  /**
   * Chunk a document without generating embeddings.
   *
   * Useful for:
   * - Testing chunking logic without Ollama
   * - Previewing how a document will be split
   * - Batch processing where embeddings are generated separately
   */
  chunkDocumentWithoutEmbeddings(input: ChunkInput): TextChunk[] {
    const { content, sections } = input;
    let textChunks = splitIntoChunks(content, this.config);
    textChunks = assignSectionsToChunks(textChunks, content, sections);
    return textChunks;
  }
}

/**
 * Factory function to create a DocumentChunker.
 */
export function createDocumentChunker(
  ollamaClient: IOllamaClient,
  config?: Partial<ChunkingConfig>
): DocumentChunker {
  return new DocumentChunker(ollamaClient, config);
}
