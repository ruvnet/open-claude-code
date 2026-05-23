/**
 * SendMessage Tool — send a message to a teammate agent.
 *
 * Used in multi-agent (teams) mode to communicate between agents.
 * Messages are stored in a shared message queue.
 */

import { randomBytes } from 'crypto';

const messageQueue = new Map(); // agentId -> messages[]

export const SendMessageTool = {
    name: 'SendMessage',
    description: 'Send a message to a teammate agent in multi-agent mode.',
    inputSchema: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'Target agent ID or name',
            },
            content: {
                type: 'string',
                description: 'Message content to send',
            },
            type: {
                type: 'string',
                enum: ['request', 'response', 'notification', 'handoff'],
                description: 'Message type (default: notification)',
            },
        },
        required: ['to', 'content'],
    },

    validateInput(input) {
        const errors = [];
        if (!input.to) errors.push('to is required');
        if (!input.content) errors.push('content is required');
        return errors;
    },

    async call(input) {
        // Use cryptographically secure random bytes for message IDs to
        // prevent guessing/enumeration of message identifiers.
        const msg = {
            id: `msg_${Date.now()}_${randomBytes(6).toString('hex')}`,
            from: process.env.AGENT_ID || 'main',
            to: input.to,
            type: input.type || 'notification',
            content: input.content,
            timestamp: new Date().toISOString(),
        };

        if (!messageQueue.has(input.to)) {
            messageQueue.set(input.to, []);
        }
        messageQueue.get(input.to).push(msg);

        return `Message sent to "${input.to}" (id: ${msg.id}, type: ${msg.type})`;
    },

    // Helper: receive messages for an agent
    receive(agentId) {
        const messages = messageQueue.get(agentId) || [];
        messageQueue.set(agentId, []);
        return messages;
    },
};
