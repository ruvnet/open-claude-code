/**
 * Web Fetch Tool — fetch URL content using built-in Node.js fetch.
 *
 * Security: validates the URL before fetching to prevent SSRF attacks.
 * Private/link-local/loopback addresses and cloud metadata endpoints are
 * blocked so the tool cannot be used to probe internal network services.
 */

import { isPrivateHost } from '../permissions/ssrf-check.mjs';

export const WebFetchTool = {
    name: 'WebFetch',
    description: 'Fetch content from a URL. Returns the response body as text.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'The URL to fetch' },
            headers: {
                type: 'object',
                description: 'Optional HTTP headers',
            },
            max_length: {
                type: 'number',
                description: 'Max response length in characters (default: 50000)',
            },
        },
        required: ['url'],
    },

    validateInput(input) {
        const errors = [];
        if (!input.url) errors.push('url is required');
        try {
            const parsed = new URL(input.url);
            // Only allow http and https protocols
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                errors.push('url must use http or https protocol');
            }
            // Block SSRF: reject private/internal/loopback hosts
            if (isPrivateHost(parsed.hostname)) {
                errors.push('url must not target private or internal network addresses');
            }
        } catch {
            errors.push('url must be a valid URL');
        }
        return errors;
    },

    async call(input) {
        const maxLength = input.max_length || 50000;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const res = await fetch(input.url, {
                headers: input.headers || {},
                signal: controller.signal,
                redirect: 'follow',
            });

            clearTimeout(timeout);

            if (!res.ok) {
                return `HTTP ${res.status}: ${res.statusText}`;
            }

            const contentType = res.headers.get('content-type') || '';
            const text = await res.text();
            const truncated = text.length > maxLength
                ? text.slice(0, maxLength) + `\n...[truncated at ${maxLength} chars]`
                : text;

            return `Content-Type: ${contentType}\nLength: ${text.length}\n\n${truncated}`;
        } catch (err) {
            return `Fetch error: ${err.message}`;
        }
    },
};
