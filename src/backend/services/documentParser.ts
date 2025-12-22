/**
 * Document Parser Service
 *
 * Extracts text content from various document formats for RAG indexing.
 *
 * WHY THIS MATTERS FOR RAG:
 * Before we can search documents semantically, we need to extract their text content.
 * Different formats (Markdown, plain text, PDF) store text differently, so we need
 * format-specific parsers. The extracted text is then chunked and embedded.
 *
 * INTERVIEW TALKING POINTS:
 * - Strategy pattern: Each parser implements the same interface but handles different formats
 * - Separation of concerns: Parsing is isolated from chunking and embedding
 * - Error handling: Graceful degradation when parsing fails
 */

import { DocumentType } from '../../shared/types';

/**
 * Result of parsing a document.
 * Contains the extracted text and optional metadata.
 */
export interface ParseResult {
  content: string;
  metadata: {
    title?: string;
    sections?: string[];
    pageCount?: number;
  };
}

/**
 * Interface for document parsers.
 * Each supported format implements this interface.
 */
export interface DocumentParser {
  parse(input: string | Buffer): Promise<ParseResult>;
}

/**
 * Parses Markdown documents.
 *
 * WHY KEEP MARKDOWN SYNTAX:
 * We preserve most markdown syntax because:
 * 1. Headers indicate document structure (useful for chunking)
 * 2. Code blocks contain valuable technical content
 * 3. The LLM can understand markdown formatting
 *
 * We only strip elements that don't add semantic value (images, horizontal rules).
 */
export class MarkdownParser implements DocumentParser {
  async parse(input: string | Buffer): Promise<ParseResult> {
    const text = typeof input === 'string' ? input : input.toString('utf-8');

    // Extract title from first H1 if present
    const titleMatch = text.match(/^#\s+(.+)$/m);
    const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : undefined;

    // Extract section headers for metadata
    const sectionMatches = text.matchAll(/^#{1,6}\s+(.+)$/gm);
    const sections = Array.from(sectionMatches)
      .map((m) => m[1])
      .filter((s): s is string => s !== undefined)
      .map((s) => s.trim());

    // Clean the content while preserving structure
    const content = this.cleanMarkdown(text);

    return {
      content,
      metadata: {
        title,
        sections: sections.length > 0 ? sections : undefined,
      },
    };
  }

  /**
   * Cleans markdown while preserving semantic content.
   * Removes images and horizontal rules but keeps text structure.
   */
  private cleanMarkdown(text: string): string {
    return (
      text
        // Remove image syntax but keep alt text (it's often descriptive)
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        // Remove horizontal rules
        .replace(/^[-*_]{3,}\s*$/gm, '')
        // Normalize multiple blank lines to single
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  }
}

/**
 * Parses plain text documents.
 *
 * The simplest parser - text is already in the format we need.
 * We just normalize whitespace and extract any structure we can infer.
 */
export class PlainTextParser implements DocumentParser {
  async parse(input: string | Buffer): Promise<ParseResult> {
    const text = typeof input === 'string' ? input : input.toString('utf-8');

    // Try to extract title from first non-empty line
    const lines = text.split('\n').filter((line) => line.trim());
    const firstLine = lines[0];
    const title = firstLine ? firstLine.trim() : undefined;

    // Normalize whitespace
    const content = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    return {
      content,
      metadata: {
        title,
      },
    };
  }
}

/**
 * Parses PDF documents using pdf-parse library.
 *
 * WHY PDF PARSING IS TRICKY:
 * PDFs are designed for visual rendering, not text extraction. They can contain:
 * - Text in arbitrary order (not reading order)
 * - Embedded fonts that map characters differently
 * - Scanned images (requires OCR, which we don't support)
 *
 * pdf-parse handles most common cases but may struggle with complex layouts.
 */
export class PdfParser implements DocumentParser {
  async parse(input: string | Buffer): Promise<ParseResult> {
    // pdf-parse requires a Buffer
    const buffer = typeof input === 'string' ? Buffer.from(input, 'base64') : input;

    try {
      // Dynamic import to handle the CommonJS module
      const pdfParse = await import('pdf-parse');
      const pdf = await pdfParse.default(buffer);

      return {
        content: pdf.text.trim(),
        metadata: {
          pageCount: pdf.numpages,
          title: pdf.info?.Title || undefined,
        },
      };
    } catch (error) {
      // Provide helpful error message for common issues
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to parse PDF: ${message}. The file may be corrupted, password-protected, or contain only scanned images.`);
    }
  }
}

/**
 * Factory function to get the appropriate parser for a document type.
 *
 * WHY USE A FACTORY:
 * - Encapsulates parser selection logic
 * - Easy to add new formats without changing calling code
 * - Parsers can be stateless singletons (memory efficient)
 */
const parsers: Record<DocumentType, DocumentParser> = {
  markdown: new MarkdownParser(),
  text: new PlainTextParser(),
  pdf: new PdfParser(),
};

export function getParser(type: DocumentType): DocumentParser {
  const parser = parsers[type];
  if (!parser) {
    throw new Error(`Unsupported document type: ${type}`);
  }
  return parser;
}

/**
 * Convenience function to parse a document given its type and content.
 */
export async function parseDocument(type: DocumentType, content: string | Buffer): Promise<ParseResult> {
  const parser = getParser(type);
  return parser.parse(content);
}

/**
 * Detects document type from filename extension.
 * Returns undefined if the extension is not supported.
 */
export function detectDocumentType(filename: string): DocumentType | undefined {
  const ext = filename.toLowerCase().split('.').pop();

  switch (ext) {
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'txt':
      return 'text';
    case 'pdf':
      return 'pdf';
    default:
      return undefined;
  }
}
