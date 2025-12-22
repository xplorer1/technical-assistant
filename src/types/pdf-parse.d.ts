/**
 * Type declarations for pdf-parse library.
 * pdf-parse doesn't ship with TypeScript types, so we declare them here.
 */

declare module 'pdf-parse' {
  interface PDFInfo {
    Title?: string;
    Author?: string;
    Subject?: string;
    Keywords?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
  }

  interface PDFMetadata {
    _metadata?: Record<string, unknown>;
  }

  interface PDFData {
    /** Number of pages in the PDF */
    numpages: number;
    /** Number of rendered pages */
    numrender: number;
    /** PDF info object */
    info: PDFInfo | null;
    /** PDF metadata */
    metadata: PDFMetadata | null;
    /** Extracted text content */
    text: string;
    /** PDF version */
    version: string;
  }

  interface PDFParseOptions {
    /** Maximum number of pages to parse (default: 0 = all) */
    max?: number;
    /** Page render callback */
    pagerender?: (pageData: unknown) => string;
  }

  function pdfParse(dataBuffer: Buffer, options?: PDFParseOptions): Promise<PDFData>;

  export = pdfParse;
}
