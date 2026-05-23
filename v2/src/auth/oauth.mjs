/**
 * OAuth Client — PKCE OAuth flow for Anthropic and other providers.
 *
 * Supports:
 * - Device code flow (for headless environments)
 * - Authorization code + PKCE
 * - Token refresh
 * - Credential storage in ~/.claude/credentials
 * - Codex (OpenAI) OAuth via CODEX_CLIENT_ID / OPENAI_CLIENT_ID env vars
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Well-known provider presets.
 * Consumers can pass `provider: 'codex'` (or `'openai'`) to switch endpoints.
 */
const PROVIDER_PRESETS = {
    anthropic: {
        authUrl: 'https://console.anthropic.com/oauth/authorize',
        tokenUrl: 'https://console.anthropic.com/oauth/token',
        deviceUrl: 'https://console.anthropic.com/oauth/device',
    },
    codex: {
        authUrl: 'https://auth.openai.com/authorize',
        tokenUrl: 'https://auth.openai.com/oauth/token',
        deviceUrl: 'https://auth.openai.com/oauth/device/code',
    },
    openai: {
        authUrl: 'https://auth.openai.com/authorize',
        tokenUrl: 'https://auth.openai.com/oauth/token',
        deviceUrl: 'https://auth.openai.com/oauth/device/code',
    },
};

export class OAuthClient {
    /**
     * @param {string} clientId - OAuth client ID
     * @param {object} [options]
     * @param {string} [options.provider] - 'anthropic' | 'codex' | 'openai' (default: 'anthropic')
     * @param {string} [options.authUrl] - authorization endpoint (overrides provider preset)
     * @param {string} [options.tokenUrl] - token endpoint (overrides provider preset)
     * @param {string} [options.deviceUrl] - device authorization endpoint (overrides provider preset)
     * @param {string} [options.credentialsPath] - path to store credentials
     */
    constructor(clientId, options = {}) {
        this.clientId = clientId;

        const preset = PROVIDER_PRESETS[options.provider] || PROVIDER_PRESETS.anthropic;
        this.authUrl = options.authUrl || preset.authUrl;
        this.tokenUrl = options.tokenUrl || preset.tokenUrl;
        this.deviceUrl = options.deviceUrl || preset.deviceUrl;
        this.credentialsPath = options.credentialsPath ||
            path.join(os.homedir(), '.claude', 'credentials');
    }

    /**
     * Create a client pre-configured for Codex / OpenAI auth.
     * Falls back to CODEX_CLIENT_ID → OPENAI_CLIENT_ID env vars.
     * @param {object} [options]
     * @returns {OAuthClient}
     */
    static forCodex(options = {}) {
        const clientId = options.clientId ||
            process.env.CODEX_CLIENT_ID ||
            process.env.OPENAI_CLIENT_ID ||
            'codex-default';
        return new OAuthClient(clientId, { ...options, provider: 'codex' });
    }

    /**
     * Generate a PKCE code verifier and challenge.
     * @returns {{ verifier: string, challenge: string }}
     */
    generatePKCE() {
        const verifier = crypto.randomBytes(32)
            .toString('base64url')
            .replace(/[^a-zA-Z0-9]/g, '')
            .substring(0, 128);

        const challenge = crypto
            .createHash('sha256')
            .update(verifier)
            .digest('base64url');

        return { verifier, challenge };
    }

    /**
     * Get the authorization URL for the PKCE flow.
     * @param {object} [options]
     * @param {string} [options.redirectUri] - redirect URI
     * @param {string} [options.scope] - requested scope
     * @returns {{ url: string, verifier: string, state: string }}
     */
    getAuthorizationUrl(options = {}) {
        const { verifier, challenge } = this.generatePKCE();
        const state = crypto.randomBytes(16).toString('hex');

        const params = new URLSearchParams({
            client_id: this.clientId,
            response_type: 'code',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
            redirect_uri: options.redirectUri || 'http://localhost:9876/callback',
            ...(options.scope && { scope: options.scope }),
        });

        return {
            url: `${this.authUrl}?${params.toString()}`,
            verifier,
            state,
        };
    }

    /**
     * Start a device code flow (for headless environments).
     * @returns {Promise<{ device_code: string, user_code: string, verification_uri: string, interval: number, expires_in: number }>}
     */
    async startDeviceFlow() {
        const body = new URLSearchParams({
            client_id: this.clientId,
        });

        const res = await fetch(this.deviceUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Device flow failed (${res.status}): ${text}`);
        }

        return res.json();
    }

    /**
     * Exchange an authorization code for tokens (PKCE flow).
     * @param {string} code - authorization code
     * @param {string} verifier - PKCE code verifier
     * @param {string} [redirectUri]
     * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in: number }>}
     */
    async exchangeCode(code, verifier, redirectUri) {
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: this.clientId,
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri || 'http://localhost:9876/callback',
        });

        const res = await fetch(this.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Token exchange failed (${res.status}): ${text}`);
        }

        const token = await res.json();
        this.saveToken(token);
        return token;
    }

    /**
     * Refresh an access token using a refresh token.
     * @param {string} refreshToken
     * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in: number }>}
     */
    async refreshToken(refreshToken) {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.clientId,
            refresh_token: refreshToken,
        });

        const res = await fetch(this.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Token refresh failed (${res.status}): ${text}`);
        }

        const token = await res.json();
        this.saveToken(token);
        return token;
    }

    /**
     * Get stored token from credentials file.
     * @returns {object|null}
     */
    getStoredToken() {
        try {
            const raw = fs.readFileSync(this.credentialsPath, 'utf-8');
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /**
     * Save a token to the credentials file.
     * @param {object} token
     */
    saveToken(token) {
        try {
            const dir = path.dirname(this.credentialsPath);
            fs.mkdirSync(dir, { recursive: true });

            const data = {
                ...token,
                saved_at: new Date().toISOString(),
            };

            fs.writeFileSync(this.credentialsPath, JSON.stringify(data, null, 2), { mode: 0o600 });
        } catch {
            // Best effort
        }
    }

    /**
     * Delete stored credentials.
     */
    clearToken() {
        try {
            fs.unlinkSync(this.credentialsPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if the stored token is expired.
     * @returns {boolean}
     */
    isTokenExpired() {
        const token = this.getStoredToken();
        if (!token || !token.saved_at || !token.expires_in) return true;

        const savedAt = new Date(token.saved_at).getTime();
        const expiresAt = savedAt + (token.expires_in * 1000);
        return Date.now() >= expiresAt;
    }
}
