import { useState, useCallback, useEffect } from 'react';
import { Document, DocumentStatus } from '@shared/types';
import { api, ApiError } from '../services/apiClient';

/**
 * useDocuments Hook
 *
 * Manages document list state and upload operations for the knowledge base.
 * Addresses Requirements:
 * - 3.1: Index documentation files for future reference
 * - 3.3: Support common formats including Markdown, plain text, and PDF
 *
 * Interview talking points:
 * 1. This hook follows the same pattern as useSessions - separating
 *    document management from UI concerns
 *
 * 2. Upload progress tracking demonstrates handling async operations
 *    with intermediate state updates
 *
 * 3. Format validation happens client-side for immediate feedback,
 *    but the server also validates (defense in depth)
 */

/** Supported file extensions for upload */
export const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.pdf'] as const;
export const SUPPORTED_MIME_TYPES = [
  'text/markdown',
  'text/plain',
  'application/pdf',
  'text/x-markdown',
] as const;

export interface UploadProgress {
  /** File being uploaded */
  fileName: string;
  /** Upload status */
  status: 'uploading' | 'processing' | 'complete' | 'error';
  /** Error message if status is 'error' */
  error?: string;
}

export interface UseDocumentsState {
  /** List of all documents */
  documents: Document[];
  /** Whether documents are being loaded */
  isLoading: boolean;
  /** Current error, if any */
  error: string | null;
  /** Current upload progress, if uploading */
  uploadProgress: UploadProgress | null;
}

export interface UseDocumentsActions {
  /** Refresh the documents list from the server */
  refreshDocuments: () => Promise<void>;
  /** Upload a new document */
  uploadDocument: (file: File) => Promise<boolean>;
  /** Delete a document */
  deleteDocument: (documentId: string) => Promise<boolean>;
  /** Validate if a file is supported */
  validateFile: (file: File) => { valid: boolean; error?: string };
  /** Clear the current error */
  clearError: () => void;
  /** Clear upload progress */
  clearUploadProgress: () => void;
}

export type UseDocumentsReturn = UseDocumentsState & UseDocumentsActions;

/**
 * Check if a file has a supported extension
 */
function hasValidExtension(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/**
 * Get human-readable list of supported formats
 */
export function getSupportedFormatsText(): string {
  return 'Markdown (.md), Plain Text (.txt), PDF (.pdf)';
}

export function useDocuments(): UseDocumentsReturn {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  /**
   * Validate if a file can be uploaded
   * 
   * This provides immediate feedback before attempting upload.
   * The server also validates, but client-side validation improves UX.
   */
  const validateFile = useCallback((file: File): { valid: boolean; error?: string } => {
    // Check file extension
    if (!hasValidExtension(file.name)) {
      return {
        valid: false,
        error: `Unsupported file format. Supported formats: ${getSupportedFormatsText()}`,
      };
    }

    // Check file size (limit to 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return {
        valid: false,
        error: 'File size exceeds 10MB limit.',
      };
    }

    // Check for empty files
    if (file.size === 0) {
      return {
        valid: false,
        error: 'File is empty.',
      };
    }

    return { valid: true };
  }, []);

  /**
   * Fetch all documents from the server
   */
  const refreshDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const fetchedDocuments = await api.getDocuments();
      setDocuments(fetchedDocuments);
    } catch (err) {
      const errorMessage =
        err instanceof ApiError
          ? err.message
          : 'Failed to load documents. Please try again.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Upload a document to the knowledge base
   * 
   * Returns true if upload was successful, false otherwise.
   */
  const uploadDocument = useCallback(async (file: File): Promise<boolean> => {
    // Validate first
    const validation = validateFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return false;
    }

    setError(null);
    setUploadProgress({
      fileName: file.name,
      status: 'uploading',
    });

    try {
      // Upload the file
      const response = await api.uploadDocument(file);

      // Update progress based on response status
      if (response.status === 'indexed') {
        setUploadProgress({
          fileName: file.name,
          status: 'complete',
        });
      } else {
        // Still processing
        setUploadProgress({
          fileName: file.name,
          status: 'processing',
        });
      }

      // Refresh the document list to show the new document
      await refreshDocuments();

      return true;
    } catch (err) {
      const errorMessage =
        err instanceof ApiError
          ? err.message
          : 'Failed to upload document. Please try again.';
      
      setUploadProgress({
        fileName: file.name,
        status: 'error',
        error: errorMessage,
      });
      setError(errorMessage);
      return false;
    }
  }, [validateFile, refreshDocuments]);

  /**
   * Delete a document from the knowledge base
   */
  const deleteDocument = useCallback(async (documentId: string): Promise<boolean> => {
    setError(null);

    try {
      await api.deleteDocument(documentId);
      // Remove from local state
      setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
      return true;
    } catch (err) {
      const errorMessage =
        err instanceof ApiError
          ? err.message
          : 'Failed to delete document. Please try again.';
      setError(errorMessage);
      return false;
    }
  }, []);

  /**
   * Clear the current error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Clear upload progress
   */
  const clearUploadProgress = useCallback(() => {
    setUploadProgress(null);
  }, []);

  // Fetch documents on mount
  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  return {
    documents,
    isLoading,
    error,
    uploadProgress,
    refreshDocuments,
    uploadDocument,
    deleteDocument,
    validateFile,
    clearError,
    clearUploadProgress,
  };
}

export default useDocuments;
