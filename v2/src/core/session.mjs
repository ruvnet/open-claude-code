/**
 * Session Manager — save, resume, and teleport sessions.
 *
 * Sessions are stored at ~/.claude/projects/<hash>/session.json
 * and contain conversation history, token usage, and metadata.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export class SessionManager {
    constructor(projectDir = process.cwd()) {
        this.projectDir = projectDir;
        this.sessionId = `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        this.conversationId = null;
        this.startedAt = new Date().toISOString();
    }

    /**
     * Get the session storage directory for the current project.
     */
    getSessionDir() {
        const hash = crypto.createHash('sha256')
            .update(this.projectDir)
            .digest('hex')
            .slice(0, 16);

        return path.join(os.homedir(), '.claude', 'projects', hash);
    }

    /**
     * Save the current session state.
     * @param {object} state - agent loop state to save
     */
    save(state) {
        const dir = this.getSessionDir();
        fs.mkdirSync(dir, { recursive: true });

        const session = {
            id: this.sessionId,
            conversationId: this.conversationId,
            projectDir: this.projectDir,
            startedAt: this.startedAt,
            savedAt: new Date().toISOString(),
            model: state.model,
            turnCount: state.turnCount,
            tokenUsage: state.tokenUsage,
            messages: state.messages,
            systemPrompt: state.systemPrompt,
        };

        const filePath = path.join(dir, 'session.json');
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
        return filePath;
    }

    /**
     * Resume a saved session.
     * @param {object} state - agent loop state to restore into
     * @returns {boolean} true if session was restored
     */
    resume(state) {
        const dir = this.getSessionDir();
        const filePath = path.join(dir, 'session.json');

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const session = JSON.parse(raw);

            state.messages = session.messages || [];
            state.turnCount = session.turnCount || 0;
            state.tokenUsage = session.tokenUsage || { input: 0, output: 0 };
            if (session.model) state.model = session.model;

            this.sessionId = session.id;
            this.conversationId = session.conversationId;
            this.startedAt = session.startedAt;

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Export session for teleport (transfer between machines).
     * @param {object} state - agent loop state
     * @returns {string} base64-encoded session data
     */
    exportForTeleport(state) {
        const session = {
            id: this.sessionId,
            projectDir: this.projectDir,
            messages: state.messages,
            turnCount: state.turnCount,
            model: state.model,
            exportedAt: new Date().toISOString(),
        };

        return Buffer.from(JSON.stringify(session)).toString('base64');
    }

    /**
     * Import a teleported session.
     * @param {string} data - base64-encoded session data
     * @param {object} state - agent loop state to restore into
     */
    importFromTeleport(data, state) {
        if (typeof data !== 'string' || data.length === 0) {
            throw new Error('Invalid teleport data: must be a non-empty string');
        }

        let session;
        try {
            session = JSON.parse(Buffer.from(data, 'base64').toString());
        } catch {
            throw new Error('Invalid teleport data: failed to decode or parse');
        }

        if (typeof session !== 'object' || session === null) {
            throw new Error('Invalid teleport data: expected an object');
        }

        // Validate and sanitize messages — must be an array of {role, content}
        const rawMessages = Array.isArray(session.messages) ? session.messages : [];
        state.messages = rawMessages.filter(
            (m) => m && typeof m.role === 'string' && (typeof m.content === 'string' || Array.isArray(m.content))
        );

        // Validate turn count
        const turnCount = parseInt(session.turnCount, 10);
        state.turnCount = isNaN(turnCount) || turnCount < 0 ? 0 : turnCount;

        // Only allow known model strings (non-empty string, no shell injection)
        if (typeof session.model === 'string' && /^[\w.:/-]{3,80}$/.test(session.model)) {
            state.model = session.model;
        }

        this.sessionId = `sess_teleport_${Date.now()}`;
    }

    /**
     * Get session info.
     */
    info() {
        return {
            id: this.sessionId,
            conversationId: this.conversationId,
            projectDir: this.projectDir,
            startedAt: this.startedAt,
            sessionDir: this.getSessionDir(),
        };
    }

    /**
     * Delete the saved session.
     */
    clear() {
        const filePath = path.join(this.getSessionDir(), 'session.json');
        try {
            fs.unlinkSync(filePath);
            return true;
        } catch {
            return false;
        }
    }
}
