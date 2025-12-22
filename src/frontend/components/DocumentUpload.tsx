import React, { useCallback, useRef, useState } from 'react';
import { Document, DocumentStatus } from '@shared/types';
import {
  UploadProgress,
  getSupportedFormatsText,
  SUPPORTED_EXTENSIONS,
} from '../hooks/useDocuments';
import { LoadingIndicator } from './LoadingIndicator';

/**
 * DocumentUpload Component
 *
 * Provides UI for uploading documents to the knowledge base and viewing
 * the list of indexed documents.
 *
 * Addresses Requirements:
 * - 3.1: Index documentation files for future reference
 * - 3.3: Support common formats including Markdown, plain text, and PDF
 *
 * Interview talking points:
 * 1. File input is hidden and triggered via a styled button - this is a
 *    common pattern for custom file upload UIs
 *
 * 2. Drag-and-drop support improves UX for power users
 *
 * 3. The component shows different states: empty, loading, uploading,
 *    and the document list - demonstrating state machine thinking
 *
 * 4. Format validation happens both on selection and drop, providing
 *    immediate feedback before upload attempt
 */

export interface DocumentUploadProps {
  /** List of documents in the knowledge base */
  documents: Document[];
  /** Whether documents are being loaded */
  isLoading: boolean;
  /** Current error message, if any */
  error: string | null;
  /** Current upload progress */
  uploadProgress: UploadProgress | null;
  /** Callback to upload a file */
  onUpload: (file: File) => Promise<boolean>;
  /** Callback to delete a document */
  onDelete: (documentId: string) => Promise<boolean>;
  /** Callback to validate a file before upload */
  onValidate: (file: File) => { valid: boolean; error?: string };
  /** Callback to clear error */
  onClearError: () => void;
  /** Callback to clear upload progress */
  onClearUploadProgress: () => void;
}

/**
 * Get icon for document type
 */
function getDocumentIcon(type: string): string {
  switch (type) {
    case 'markdown':
      return '📝';
    case 'pdf':
      return '📄';
    case 'text':
    default:
      return '📃';
  }
}

/**
 * Get status badge color class
 */
function getStatusClass(status: DocumentStatus): string {
  switch (status) {
    case 'indexed':
      return 'document-item__status--indexed';
    case 'pending':
      return 'document-item__status--pending';
    case 'error':
      return 'document-item__status--error';
    default:
      return '';
  }
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const DocumentUpload: React.FC<DocumentUploadProps> = ({
  documents,
  isLoading,
  error,
  uploadProgress,
  onUpload,
  onDelete,
  onValidate,
  onClearError,
  onClearUploadProgress,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  /**
   * Handle file selection from input
   */
  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        await onUpload(file);
      }
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onUpload]
  );

  /**
   * Handle click on upload button
   */
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Handle drag over event
   */
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }, []);

  /**
   * Handle drag leave event
   */
  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  /**
   * Handle file drop
   */
  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);

      const file = event.dataTransfer.files[0];
      if (file) {
        const validation = onValidate(file);
        if (validation.valid) {
          await onUpload(file);
        }
      }
    },
    [onUpload, onValidate]
  );

  /**
   * Handle delete button click
   */
  const handleDeleteClick = useCallback((documentId: string) => {
    setDeleteConfirm(documentId);
  }, []);

  /**
   * Confirm deletion
   */
  const handleConfirmDelete = useCallback(
    async (documentId: string) => {
      await onDelete(documentId);
      setDeleteConfirm(null);
    },
    [onDelete]
  );

  /**
   * Cancel deletion
   */
  const handleCancelDelete = useCallback(() => {
    setDeleteConfirm(null);
  }, []);

  // Build accepted file extensions string for input
  const acceptedExtensions = SUPPORTED_EXTENSIONS.join(',');

  return (
    <div className="document-upload">
      {/* Header */}
      <div className="document-upload__header">
        <h2 className="document-upload__title">Knowledge Base</h2>
        <span className="document-upload__count">
          {documents.length} document{documents.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="document-upload__error">
          <span>{error}</span>
          <button
            onClick={onClearError}
            className="document-upload__error-dismiss"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Upload area */}
      <div
        className={`document-upload__dropzone ${
          isDragOver ? 'document-upload__dropzone--active' : ''
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedExtensions}
          onChange={handleFileSelect}
          className="document-upload__input"
          aria-label="Upload document"
        />

        {uploadProgress ? (
          <div className="document-upload__progress">
            <div className="document-upload__progress-info">
              <span className="document-upload__progress-filename">
                {uploadProgress.fileName}
              </span>
              <span
                className={`document-upload__progress-status document-upload__progress-status--${uploadProgress.status}`}
              >
                {uploadProgress.status === 'uploading' && 'Uploading...'}
                {uploadProgress.status === 'processing' && 'Processing...'}
                {uploadProgress.status === 'complete' && '✓ Complete'}
                {uploadProgress.status === 'error' && '✗ Failed'}
              </span>
            </div>
            {uploadProgress.status === 'uploading' ||
            uploadProgress.status === 'processing' ? (
              <LoadingIndicator size="small" />
            ) : (
              <button
                onClick={onClearUploadProgress}
                className="document-upload__progress-clear"
              >
                Clear
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="document-upload__dropzone-icon">📁</div>
            <p className="document-upload__dropzone-text">
              Drag and drop a file here, or
            </p>
            <button
              onClick={handleUploadClick}
              className="document-upload__browse-button"
            >
              Browse Files
            </button>
            <p className="document-upload__dropzone-hint">
              Supported: {getSupportedFormatsText()}
            </p>
          </>
        )}
      </div>

      {/* Document list */}
      <div className="document-upload__list">
        {isLoading ? (
          <div className="document-upload__loading">
            <LoadingIndicator message="Loading documents..." />
          </div>
        ) : documents.length === 0 ? (
          <div className="document-upload__empty">
            <p>No documents uploaded yet.</p>
            <p className="document-upload__empty-hint">
              Upload documentation to enhance the assistant's knowledge.
            </p>
          </div>
        ) : (
          <ul className="document-upload__items">
            {documents.map((doc) => (
              <li key={doc.id} className="document-item">
                <span className="document-item__icon">
                  {getDocumentIcon(doc.type)}
                </span>
                <div className="document-item__info">
                  <span className="document-item__name">{doc.name}</span>
                  <span className="document-item__meta">
                    {doc.chunkCount} chunks •{' '}
                    {formatDate(new Date(doc.uploadedAt))}
                  </span>
                </div>
                <span
                  className={`document-item__status ${getStatusClass(
                    doc.status
                  )}`}
                >
                  {doc.status}
                </span>
                {deleteConfirm === doc.id ? (
                  <div className="document-item__confirm">
                    <button
                      onClick={() => handleConfirmDelete(doc.id)}
                      className="document-item__confirm-yes"
                      aria-label="Confirm delete"
                    >
                      Yes
                    </button>
                    <button
                      onClick={handleCancelDelete}
                      className="document-item__confirm-no"
                      aria-label="Cancel delete"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleDeleteClick(doc.id)}
                    className="document-item__delete"
                    aria-label={`Delete ${doc.name}`}
                  >
                    🗑️
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default DocumentUpload;
