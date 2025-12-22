/**
 * Session Manager Service
 *
 * Manages conversation sessions with file-based JSON persistence.
 * This implements the SessionProvider interface used by the QueryProcessor.
 *
 * Key responsibilities:
 * - Create new conversation sessions
 * - Retrieve existing sessions by ID
 * - List all available sessions
 * - Add messages to sessions
 * - Persist sessions to disk as JSON files
 *
 * Why file-based storage?
 * - Simple to implement and debug (human-readable JSON)
 * - No database setup required for local development
 * - Easy to backup and migrate
 * - Sufficient for single-user or small team usage
 *
 * Trade-offs:
 * - Not suitable for high concurrency (no locking)
 * - Performance degrades with many sessions (linear scan for listing)
 * - For production scale, consider SQLite or a proper database
 *
 * Requirements: 6.1, 6.2, 6.3
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
    ConversationSession,
    ChatMessage,
    StoredSession,
    StoredMessage,
} from '../../shared/types';
import { SessionProvider } from './queryProcessor';

/**
 * Configuration options for the SessionManager.
 */
export interface SessionManagerConfig {
    /** Directory path where session files are stored */
    storagePath: string;
}

/**
 * Default storage path for sessions.
 * Using a data directory keeps things organized.
 */
const DEFAULT_STORAGE_PATH = path.join(process.cwd(), 'data', 'sessions');


/**
 * SessionManager class implementing CRUD operations for conversation sessions.
 *
 * This class also implements SessionProvider interface, making it compatible
 * with the QueryProcessor's dependency injection pattern.
 *
 * Design Pattern: Repository Pattern
 * - Encapsulates data access logic
 * - Provides a clean API for session operations
 * - Abstracts the storage mechanism (could swap to database later)
 */
export class SessionManager implements SessionProvider {
    private storagePath: string;

    constructor(config?: Partial<SessionManagerConfig>) {
        this.storagePath = config?.storagePath || DEFAULT_STORAGE_PATH;
        this.ensureStorageDirectory();
    }

    /**
     * Ensures the storage directory exists.
     * Creates it recursively if it doesn't exist.
     *
     * Why do this in constructor?
     * - Fail fast: Better to know about permission issues immediately
     * - Convenience: Callers don't need to worry about directory setup
     */
    private ensureStorageDirectory(): void {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    /**
     * Gets the file path for a session by ID.
     * Each session is stored in its own JSON file.
     */
    private getSessionFilePath(sessionId: string): string {
        return path.join(this.storagePath, `${sessionId}.json`);
    }

    /**
     * Creates a new conversation session.
     *
     * The session starts with:
     * - A unique UUID identifier
     * - A default title (can be updated later based on first message)
     * - Current timestamps for creation and update
     * - Empty message array
     *
     * @returns The newly created session
     */
    async createSession(): Promise<ConversationSession> {
        const now = new Date();
        const session: ConversationSession = {
            id: uuidv4(),
            title: 'New Conversation',
            createdAt: now,
            updatedAt: now,
            messages: [],
        };

        // Persist immediately to ensure the session exists on disk
        await this.saveSession(session);

        return session;
    }

    /**
     * Retrieves a session by its ID.
     *
     * Returns null if the session doesn't exist, allowing callers
     * to handle missing sessions gracefully.
     *
     * @param id - The session ID to retrieve
     * @returns The session if found, null otherwise
     */
    async getSession(id: string): Promise<ConversationSession | null> {
        const filePath = this.getSessionFilePath(id);

        if (!fs.existsSync(filePath)) {
            return null;
        }

        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const storedSession: StoredSession = JSON.parse(fileContent);
            return this.deserializeSession(storedSession);
        } catch (error) {
            // Log error but return null - corrupted files shouldn't crash the app
            console.error(`Error reading session ${id}:`, error);
            return null;
        }
    }

    /**
     * Lists all available sessions.
     *
     * Returns sessions sorted by updatedAt (most recent first),
     * which is the most useful order for users.
     *
     * Performance note: This reads all session files, which is fine
     * for small numbers of sessions but would need optimization
     * (e.g., an index file) for thousands of sessions.
     *
     * @returns Array of all sessions, sorted by most recently updated
     */
    async listSessions(): Promise<ConversationSession[]> {
        if (!fs.existsSync(this.storagePath)) {
            return [];
        }

        const files = fs.readdirSync(this.storagePath);
        const sessions: ConversationSession[] = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                const sessionId = file.replace('.json', '');
                const session = await this.getSession(sessionId);
                if (session) {
                    sessions.push(session);
                }
            }
        }

        // Sort by updatedAt descending (most recent first)
        sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

        return sessions;
    }

    /**
     * Adds a message to an existing session.
     *
     * This is the primary way to update a session's content.
     * It also updates the session's updatedAt timestamp.
     *
     * If this is the first user message, we could auto-generate
     * a title from it (future enhancement).
     *
     * @param sessionId - The session to add the message to
     * @param message - The message to add
     * @throws Error if the session doesn't exist
     */
    async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
        const session = await this.getSession(sessionId);

        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        // Add the message to the session
        session.messages.push(message);

        // Update the timestamp
        session.updatedAt = new Date();

        // Auto-generate title from first user message if still default
        if (
            session.title === 'New Conversation' &&
            message.role === 'user' &&
            session.messages.filter((m) => m.role === 'user').length === 1
        ) {
            session.title = this.generateTitleFromMessage(message.content);
        }

        // Persist the updated session
        await this.saveSession(session);
    }

    /**
     * Updates the title of a session.
     *
     * @param sessionId - The session to update
     * @param title - The new title
     * @throws Error if the session doesn't exist
     */
    async updateSessionTitle(sessionId: string, title: string): Promise<void> {
        const session = await this.getSession(sessionId);

        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        session.title = title;
        session.updatedAt = new Date();

        await this.saveSession(session);
    }

    /**
     * Deletes a session by ID.
     *
     * @param sessionId - The session to delete
     * @returns true if deleted, false if session didn't exist
     */
    async deleteSession(sessionId: string): Promise<boolean> {
        const filePath = this.getSessionFilePath(sessionId);

        if (!fs.existsSync(filePath)) {
            return false;
        }

        fs.unlinkSync(filePath);
        return true;
    }


    /**
     * Saves a session to disk.
     *
     * Converts the session to the stored format (with ISO date strings)
     * and writes it atomically to prevent corruption.
     *
     * @param session - The session to save
     */
    private async saveSession(session: ConversationSession): Promise<void> {
        const storedSession = this.serializeSession(session);
        const filePath = this.getSessionFilePath(session.id);

        // Write to a temp file first, then rename for atomicity
        // This prevents corruption if the process crashes mid-write
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(storedSession, null, 2));
        fs.renameSync(tempPath, filePath);
    }

    /**
     * Converts a ConversationSession to StoredSession format.
     *
     * Why serialize dates as ISO strings?
     * - JSON doesn't have a native Date type
     * - ISO strings are human-readable and sortable
     * - Universal format that works across languages/platforms
     *
     * @param session - The session to serialize
     * @returns The serialized session
     */
    private serializeSession(session: ConversationSession): StoredSession {
        return {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt.toISOString(),
            updatedAt: session.updatedAt.toISOString(),
            messages: session.messages.map((msg) => this.serializeMessage(msg)),
        };
    }

    /**
     * Converts a ChatMessage to StoredMessage format.
     */
    private serializeMessage(message: ChatMessage): StoredMessage {
        return {
            id: message.id,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp.toISOString(),
            sources: message.sources,
        };
    }

    /**
     * Converts a StoredSession back to ConversationSession format.
     *
     * This is the inverse of serializeSession - converts ISO strings
     * back to Date objects.
     *
     * @param stored - The stored session to deserialize
     * @returns The deserialized session
     */
    private deserializeSession(stored: StoredSession): ConversationSession {
        return {
            id: stored.id,
            title: stored.title,
            createdAt: new Date(stored.createdAt),
            updatedAt: new Date(stored.updatedAt),
            messages: stored.messages.map((msg) => this.deserializeMessage(msg)),
        };
    }

    /**
     * Converts a StoredMessage back to ChatMessage format.
     */
    private deserializeMessage(stored: StoredMessage): ChatMessage {
        return {
            id: stored.id,
            role: stored.role,
            content: stored.content,
            timestamp: new Date(stored.timestamp),
            sources: stored.sources,
        };
    }

    /**
     * Generates a title from the first user message.
     *
     * Takes the first ~50 characters of the message as the title,
     * truncating at a word boundary if possible.
     *
     * @param content - The message content
     * @returns A generated title
     */
    private generateTitleFromMessage(content: string): string {
        const maxLength = 50;
        const trimmed = content.trim();

        if (trimmed.length <= maxLength) {
            return trimmed;
        }

        // Try to truncate at a word boundary
        const truncated = trimmed.substring(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');

        if (lastSpace > maxLength / 2) {
            return truncated.substring(0, lastSpace) + '...';
        }

        return truncated + '...';
    }

    /**
     * Gets the storage path (useful for testing).
     */
    getStoragePath(): string {
        return this.storagePath;
    }
}

/**
 * Factory function to create a SessionManager instance.
 *
 * Why use a factory function?
 * - Provides a simple way to create instances with defaults
 * - Can be extended to implement singleton pattern if needed
 * - Makes dependency injection easier in tests
 *
 * @param config - Optional configuration
 * @returns A new SessionManager instance
 */
export function createSessionManager(
    config?: Partial<SessionManagerConfig>
): SessionManager {
    return new SessionManager(config);
}
