/**
 * Session Manager Tests
 *
 * Tests for the SessionManager class that handles conversation session
 * persistence with file-based JSON storage.
 *
 * Requirements: 6.1, 6.2, 6.3
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SessionManager, createSessionManager } from '../sessionManager';
import { ChatMessage } from '../../../shared/types';

describe('SessionManager', () => {
    let sessionManager: SessionManager;
    let testStoragePath: string;

    beforeEach(() => {
        testStoragePath = path.join(
            process.cwd(),
            'data',
            'test-sessions',
            uuidv4()
        );
        sessionManager = createSessionManager({ storagePath: testStoragePath });
    });

    afterEach(() => {
        if (fs.existsSync(testStoragePath)) {
            const files = fs.readdirSync(testStoragePath);
            for (const file of files) {
                fs.unlinkSync(path.join(testStoragePath, file));
            }
            fs.rmdirSync(testStoragePath);
        }
    });

    describe('createSession', () => {
        it('should create a new session with unique ID', async () => {
            const session = await sessionManager.createSession();
            expect(session.id).toBeDefined();
            expect(typeof session.id).toBe('string');
        });

        it('should create session with default title', async () => {
            const session = await sessionManager.createSession();
            expect(session.title).toBe('New Conversation');
        });

        it('should create session with timestamps', async () => {
            const before = new Date();
            const session = await sessionManager.createSession();
            const after = new Date();

            expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(session.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
        });

        it('should create session with empty messages array', async () => {
            const session = await sessionManager.createSession();
            expect(session.messages).toEqual([]);
        });

        it('should persist session to disk', async () => {
            const session = await sessionManager.createSession();
            const filePath = path.join(testStoragePath, `${session.id}.json`);
            expect(fs.existsSync(filePath)).toBe(true);
        });
    });

    describe('getSession', () => {
        it('should retrieve an existing session by ID', async () => {
            const created = await sessionManager.createSession();
            const retrieved = await sessionManager.getSession(created.id);

            expect(retrieved).not.toBeNull();
            expect(retrieved!.id).toBe(created.id);
            expect(retrieved!.title).toBe(created.title);
        });

        it('should return null for non-existent session', async () => {
            const result = await sessionManager.getSession('non-existent-id');
            expect(result).toBeNull();
        });

        it('should deserialize dates correctly', async () => {
            const created = await sessionManager.createSession();
            const retrieved = await sessionManager.getSession(created.id);

            expect(retrieved!.createdAt).toBeInstanceOf(Date);
            expect(retrieved!.updatedAt).toBeInstanceOf(Date);
        });
    });

    describe('listSessions', () => {
        it('should return empty array when no sessions exist', async () => {
            const sessions = await sessionManager.listSessions();
            expect(sessions).toEqual([]);
        });

        it('should return all created sessions', async () => {
            await sessionManager.createSession();
            await sessionManager.createSession();
            await sessionManager.createSession();

            const sessions = await sessionManager.listSessions();
            expect(sessions.length).toBe(3);
        });

        it('should sort sessions by updatedAt descending', async () => {
            const session1 = await sessionManager.createSession();
            await sessionManager.createSession();
            await sessionManager.createSession();

            // Update session1 to make it most recent
            const message: ChatMessage = {
                id: uuidv4(),
                role: 'user',
                content: 'Test message',
                timestamp: new Date(),
            };
            await sessionManager.addMessage(session1.id, message);

            const sessions = await sessionManager.listSessions();
            expect(sessions[0].id).toBe(session1.id);
        });
    });

    describe('addMessage', () => {
        it('should add message to session', async () => {
            const session = await sessionManager.createSession();
            const message: ChatMessage = {
                id: uuidv4(),
                role: 'user',
                content: 'Hello, assistant!',
                timestamp: new Date(),
            };

            await sessionManager.addMessage(session.id, message);

            const updated = await sessionManager.getSession(session.id);
            expect(updated!.messages.length).toBe(1);
            expect(updated!.messages[0].content).toBe('Hello, assistant!');
        });

        it('should preserve message order', async () => {
            const session = await sessionManager.createSession();

            const messages: ChatMessage[] = [
                { id: uuidv4(), role: 'user', content: 'First', timestamp: new Date() },
                { id: uuidv4(), role: 'assistant', content: 'Second', timestamp: new Date() },
                { id: uuidv4(), role: 'user', content: 'Third', timestamp: new Date() },
            ];

            for (const msg of messages) {
                await sessionManager.addMessage(session.id, msg);
            }

            const updated = await sessionManager.getSession(session.id);
            expect(updated!.messages.map((m) => m.content)).toEqual(['First', 'Second', 'Third']);
        });

        it('should auto-generate title from first user message', async () => {
            const session = await sessionManager.createSession();
            const message: ChatMessage = {
                id: uuidv4(),
                role: 'user',
                content: 'How do I configure TypeScript?',
                timestamp: new Date(),
            };

            await sessionManager.addMessage(session.id, message);

            const updated = await sessionManager.getSession(session.id);
            expect(updated!.title).toBe('How do I configure TypeScript?');
        });

        it('should throw error for non-existent session', async () => {
            const message: ChatMessage = {
                id: uuidv4(),
                role: 'user',
                content: 'Test',
                timestamp: new Date(),
            };

            await expect(
                sessionManager.addMessage('non-existent', message)
            ).rejects.toThrow('Session not found');
        });
    });

    describe('deleteSession', () => {
        it('should delete existing session', async () => {
            const session = await sessionManager.createSession();
            const result = await sessionManager.deleteSession(session.id);

            expect(result).toBe(true);
            expect(await sessionManager.getSession(session.id)).toBeNull();
        });

        it('should return false for non-existent session', async () => {
            const result = await sessionManager.deleteSession('non-existent');
            expect(result).toBe(false);
        });
    });

    describe('factory function', () => {
        it('should create SessionManager with default config', () => {
            const manager = createSessionManager();
            expect(manager).toBeInstanceOf(SessionManager);
        });
    });
});
