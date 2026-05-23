/**
 * Web Search Tool — search the web via configurable API backends.
 *
 * Supports:
 * - Brave Search API (BRAVE_API_KEY)
 * - SearXNG (self-hosted, SEARXNG_URL)
 * - Fallback: returns instructions to use web-fetch instead
 *
 * Security: validates that SEARXNG_URL does not target private/internal
 * addresses (SSRF guard) before making requests.
 */
import { isPrivateHost } from '../permissions/ssrf-check.mjs';

export const WebSearchTool = {
    name: 'WebSearch',
    description: 'Search the web for information. Requires BRAVE_API_KEY or SEARXNG_URL.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default: 5)' },
        },
        required: ['query'],
    },

    validateInput(input) {
        return input.query ? [] : ['query is required'];
    },

    async call(input) {
        const limit = input.limit || 5;

        // Try Brave Search API
        const braveKey = process.env.BRAVE_API_KEY;
        if (braveKey) {
            return searchBrave(input.query, limit, braveKey);
        }

        // Try SearXNG — validate the configured URL is not an internal host
        const searxUrl = process.env.SEARXNG_URL;
        if (searxUrl) {
            try {
                const parsed = new URL(searxUrl);
                if (isPrivateHost(parsed.hostname)) {
                    return 'SEARXNG_URL points to a private/internal address. Configure a public SearXNG instance.';
                }
            } catch {
                return 'SEARXNG_URL is not a valid URL.';
            }
            return searchSearxng(input.query, limit, searxUrl);
        }

        return 'No search API configured. Set BRAVE_API_KEY or SEARXNG_URL environment variable. ' +
            'Alternatively, use the WebFetch tool to fetch specific URLs directly.';
    },
};

async function searchBrave(query, limit, apiKey) {
    try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
        const res = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': apiKey,
            },
        });

        if (!res.ok) return `Brave API error: ${res.status}`;

        const data = await res.json();
        const results = (data.web?.results || []).slice(0, limit);

        if (results.length === 0) return 'No results found.';

        return results.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description || ''}`
        ).join('\n\n');
    } catch (err) {
        return `Search error: ${err.message}`;
    }
}

async function searchSearxng(query, limit, baseUrl) {
    try {
        const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
        const res = await fetch(url);

        if (!res.ok) return `SearXNG error: ${res.status}`;

        const data = await res.json();
        const results = (data.results || []).slice(0, limit);

        if (results.length === 0) return 'No results found.';

        return results.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content || ''}`
        ).join('\n\n');
    } catch (err) {
        return `Search error: ${err.message}`;
    }
}
