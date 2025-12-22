/**
 * Document Storage Service
 *
 * Manages document persistence for the knowledge base.
 * Documents are stored as JSON files with their content and metadata.
 *
 * Key responsibilities:
 * - Store uploaded documents
 * - Retrieve documents by ID
 * - List all documents
 * - Delete documents
 * - Track document status (pending, indexed, error)
 *
 * WHY FILE-BASED STORAGE:
 * - Simple to implement and debug
 * - No database setup required
 * - Easy to backup and migrate
 * - Sufficient for small team usage
 *
 * Requirements: 3.1, 3.2
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Document, DocumentType, DocumentStatus } from '../../shared/types';

/**
 * Configuration for document storage.
 */
export interface DocumentStorageConfig {
    /** Directory path where documents are stored */
    storagePath: string;
}

/**
 * Default storage path for documents.
 */
const DEFAULT_STORAGE_PATH = path.join(process.cwd(), 'data', 'documents');

/**
 * Stored document format (JSON serialization).
 */
interface StoredDocument {
    id: string;
    name: string;
    type: DocumentType;
    content: string;
    uploadedAt: string; // ISO date
    indexedAt?: string; // ISO date
    status: DocumentStatus;
    chunkCount: number;
}

/**
 * Interface for document storage operations.
 */
export interface IDocumentStorage {
    saveDocument(name: string, type: DocumentType, content: string): Promise<Document>;
    getDocument(id: string): Promise<Document | null>;
    listDocuments(): Promise<Document[]>;
    deleteDocument(id: string): Promise<boolean>;
    updateDocumentStatus(id: string, status: DocumentStatus, chunkCount?: number): Promise<void>;
}

/**
 * Document Storage implementation.
 */
export class DocumentStorage implements IDocumentStorage {
    private storagePath: string;

    constructor(config?: Partial<DocumentStorageConfig>) {
        this.storagePath = config?.storagePath || DEFAULT_STORAGE_PATH;
        this.ensureStorageDirectory();
    }

    /**
     * Ensures the storage directory exists.
     */
    private ensureStorageDirectory(): void {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    /**
     * Gets the file path for a document by ID.
     */
    private getDocumentFilePath(documentId: string): string {
        return path.join(this.storagePath, `${documentId}.json`);
    }

    /**
     * Saves a new document.
     *
     * @param name - Original filename
     * @param type - Document type (markdown, text, pdf)
     * @param content - Document content
     * @returns The saved document
     */
    async saveDocument(
        name: string,
        type: DocumentType,
        content: string
    ): Promise<Document> {
        const now = new Date();
        const document: Document = {
            id: uuidv4(),
            name,
            type,
            content,
            uploadedAt: now,
            status: 'pending',
            chunkCount: 0,
        };

        await this.persistDocument(document);
        return document;
    }

    /**
     * Retrieves a document by ID.
     *
     * @param id - Document ID
     * @returns The document if found, null otherwise
     */
    async getDocument(id: string): Promise<Document | null> {
        const filePath = this.getDocumentFilePath(id);

        if (!fs.existsSync(filePath)) {
            return null;
        }

        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const stored: StoredDocument = JSON.parse(fileContent);
            return this.deserializeDocument(stored);
        } catch (error) {
            console.error(`Error reading document ${id}:`, error);
            return null;
        }
    }

    /**
     * Lists all documents.
     *
     * @returns Array of all documents, sorted by upload date (newest first)
     */
    async listDocuments(): Promise<Document[]> {
        if (!fs.existsSync(this.storagePath)) {
            return [];
        }

        const files = fs.readdirSync(this.storagePath);
        const documents: Document[] = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                const documentId = file.replace('.json', '');
                const document = await this.getDocument(documentId);
                if (document) {
                    documents.push(document);
                }
            }
        }

        // Sort by uploadedAt descending (newest first)
        documents.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

        return documents;
    }

    /**
     * Deletes a document by ID.
     *
     * @param id - Document ID
     * @returns true if deleted, false if not found
     */
    async deleteDocument(id: string): Promise<boolean> {
        const filePath = this.getDocumentFilePath(id);

        if (!fs.existsSync(filePath)) {
            return false;
        }

        fs.unlinkSync(filePath);
        return true;
    }

    /**
     * Updates document status after indexing.
     *
     * @param id - Document ID
     * @param status - New status
     * @param chunkCount - Number of chunks created (for indexed status)
     */
    async updateDocumentStatus(
        id: string,
        status: DocumentStatus,
        chunkCount?: number
    ): Promise<void> {
        const document = await this.getDocument(id);

        if (!document) {
            throw new Error(`Document not found: ${id}`);
        }

        document.status = status;

        if (status === 'indexed') {
            document.indexedAt = new Date();
            if (chunkCount !== undefined) {
                document.chunkCount = chunkCount;
            }
        }

        await this.persistDocument(document);
    }

    /**
     * Persists a document to disk.
     */
    private async persistDocument(document: Document): Promise<void> {
        const stored = this.serializeDocument(document);
        const filePath = this.getDocumentFilePath(document.id);

        // Write atomically
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(stored, null, 2));
        fs.renameSync(tempPath, filePath);
    }

    /**
     * Serializes a Document to StoredDocument format.
     */
    private serializeDocument(document: Document): StoredDocument {
        return {
            id: document.id,
            name: document.name,
            type: document.type,
            content: document.content,
            uploadedAt: document.uploadedAt.toISOString(),
            indexedAt: document.indexedAt?.toISOString(),
            status: document.status,
            chunkCount: document.chunkCount,
        };
    }

    /**
     * Deserializes a StoredDocument to Document format.
     */
    private deserializeDocument(stored: StoredDocument): Document {
        return {
            id: stored.id,
            name: stored.name,
            type: stored.type,
            content: stored.content,
            uploadedAt: new Date(stored.uploadedAt),
            indexedAt: stored.indexedAt ? new Date(stored.indexedAt) : undefined,
            status: stored.status,
            chunkCount: stored.chunkCount,
        };
    }

    /**
     * Gets the storage path (useful for testing).
     */
    getStoragePath(): string {
        return this.storagePath;
    }
}

/**
 * Factory function to create a DocumentStorage instance.
 */
export function createDocumentStorage(
    config?: Partial<DocumentStorageConfig>
): DocumentStorage {
    return new DocumentStorage(config);
}
