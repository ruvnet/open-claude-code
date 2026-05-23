/**
 * Environment Variables — support for Claude Code env vars.
 *
 * Reads and normalizes the ~50 most important environment variables
 * that control Claude Code behavior.
 */

/**
 * All supported environment variables with defaults and descriptions.
 */
export const ENV_SCHEMA = {
    // API Configuration
    ANTHROPIC_API_KEY: { type: 'string', description: 'Anthropic API key' },
    ANTHROPIC_BASE_URL: { type: 'string', default: 'https://api.anthropic.com', description: 'Anthropic API base URL' },
    ANTHROPIC_MODEL: { type: 'string', description: 'Override default model' },
    OPENAI_API_KEY: { type: 'string', description: 'OpenAI API key for compatible models' },
    OPENAI_BASE_URL: { type: 'string', default: 'https://api.openai.com/v1', description: 'OpenAI-compatible base URL' },
    GOOGLE_API_KEY: { type: 'string', description: 'Google AI API key' },
    GEMINI_API_KEY: { type: 'string', description: 'Alias for GOOGLE_API_KEY' },
    NVIDIA_API_KEY: { type: 'string', description: 'NVIDIA NIM API key (integrate.api.nvidia.com)' },

    // Model Configuration
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: { type: 'number', default: 16384, description: 'Max output tokens' },
    CLAUDE_CODE_SUBAGENT_MODEL: { type: 'string', description: 'Model for subagents' },
    CLAUDE_CODE_EFFORT_LEVEL: { type: 'string', default: 'normal', description: 'Effort level (low/normal/high)' },

    // Behavior Flags
    CLAUDE_CODE_BRIEF: { type: 'boolean', default: false, description: 'Brief output mode' },
    CLAUDE_CODE_DISABLE_CRON: { type: 'boolean', default: false, description: 'Disable cron tasks' },
    CLAUDE_CODE_ENABLE_TASKS: { type: 'boolean', default: false, description: 'Enable task system' },
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: { type: 'boolean', default: false, description: 'Enable agent teams' },
    CLAUDE_CODE_DEBUG: { type: 'boolean', default: false, description: 'Debug mode' },
    CLAUDE_CODE_DISABLE_TELEMETRY: { type: 'boolean', default: false, description: 'Disable telemetry' },

    // Permission and Security
    CLAUDE_CODE_PERMISSION_MODE: { type: 'string', default: 'default', description: 'Permission mode' },
    CLAUDE_CODE_SANDBOX: { type: 'boolean', default: true, description: 'Enable sandbox' },

    // Context and Memory
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: { type: 'number', default: 180000, description: 'Max context window tokens' },
    CLAUDE_CODE_AUTO_COMPACT: { type: 'boolean', default: true, description: 'Auto-compact context' },

    // UI and Display
    SHOW_THINKING: { type: 'boolean', default: false, description: 'Show thinking blocks' },
    SHOW_TOOL_RESULTS: { type: 'boolean', default: false, description: 'Show tool results in REPL' },
    NO_COLOR: { type: 'boolean', default: false, description: 'Disable colored output' },
    TERM: { type: 'string', description: 'Terminal type' },

    // MCP
    MCP_DEBUG: { type: 'boolean', default: false, description: 'MCP debug logging' },

    // Remote
    REMOTE_AGENT_URL: { type: 'string', description: 'Remote agent endpoint' },
    REMOTE_AGENT_TOKEN: { type: 'string', description: 'Remote agent auth token' },

    // Search
    BRAVE_API_KEY: { type: 'string', description: 'Brave Search API key' },
    SEARXNG_URL: { type: 'string', description: 'SearXNG instance URL' },

    // Networking
    HTTP_PROXY: { type: 'string', description: 'HTTP proxy URL' },
    HTTPS_PROXY: { type: 'string', description: 'HTTPS proxy URL' },
    NO_PROXY: { type: 'string', description: 'No-proxy list' },

    // Agent Identity
    AGENT_ID: { type: 'string', default: 'main', description: 'Agent identifier for teams' },

    // Feature Flags
    CLAUDE_CODE_THINKING: { type: 'boolean', default: false, description: 'Enable extended thinking' },
    CLAUDE_CODE_THINKING_BUDGET: { type: 'number', default: 10000, description: 'Thinking token budget' },
    CLAUDE_CODE_STREAMING: { type: 'boolean', default: true, description: 'Enable streaming' },

    // Paths
    CLAUDE_CONFIG_DIR: { type: 'string', description: 'Custom config directory' },
    CLAUDE_CACHE_DIR: { type: 'string', description: 'Custom cache directory' },

    // Extended: OAuth & Auth
    CLAUDE_OAUTH_CLIENT_ID: { type: 'string', description: 'OAuth client ID' },
    CLAUDE_OAUTH_REDIRECT_URI: { type: 'string', default: 'http://localhost:9876/callback', description: 'OAuth redirect URI' },
    ANTHROPIC_AUTH_TOKEN: { type: 'string', description: 'Anthropic auth token (OAuth)' },

    // Extended: Sandbox & Security
    CLAUDE_CODE_SANDBOX_PLATFORM: { type: 'string', description: 'Override sandbox platform (linux/darwin)' },
    CLAUDE_CODE_INJECTION_CHECK: { type: 'boolean', default: true, description: 'Enable command injection checks' },
    CLAUDE_CODE_PATH_CHECK: { type: 'boolean', default: true, description: 'Enable file path validation' },

    // Extended: Rate Limiting
    CLAUDE_CODE_MAX_RETRIES: { type: 'number', default: 5, description: 'Max API retries on 429/529' },
    CLAUDE_CODE_RETRY_BASE_DELAY: { type: 'number', default: 1000, description: 'Base retry delay in ms' },
    CLAUDE_CODE_RETRY_MAX_DELAY: { type: 'number', default: 60000, description: 'Max retry delay in ms' },

    // Extended: Agent Teams
    CLAUDE_CODE_TEAM_SIZE: { type: 'number', default: 5, description: 'Max team size for multi-agent' },
    CLAUDE_CODE_TEAM_BROADCAST: { type: 'boolean', default: false, description: 'Broadcast messages to all teammates' },

    // Extended: Providers
    AWS_ACCESS_KEY_ID: { type: 'string', description: 'AWS access key for Bedrock' },
    AWS_SECRET_ACCESS_KEY: { type: 'string', description: 'AWS secret key for Bedrock' },
    AWS_REGION: { type: 'string', default: 'us-east-1', description: 'AWS region for Bedrock' },
    GOOGLE_APPLICATION_CREDENTIALS: { type: 'string', description: 'GCP service account credentials path' },
    VERTEX_PROJECT: { type: 'string', description: 'GCP project for Vertex AI' },
    VERTEX_REGION: { type: 'string', default: 'us-central1', description: 'GCP region for Vertex AI' },

    // Extended: Cron & Scheduling
    CLAUDE_CODE_CRON_INTERVAL: { type: 'number', default: 60000, description: 'Cron check interval in ms' },
    CLAUDE_CODE_SCHEDULED_TASKS_FILE: { type: 'string', description: 'Path to scheduled tasks JSON' },

    // Extended: Plugins
    CLAUDE_CODE_PLUGIN_DIR: { type: 'string', description: 'Custom plugin directory' },
    CLAUDE_CODE_DISABLE_PLUGINS: { type: 'boolean', default: false, description: 'Disable all plugins' },

    // Extended: Session
    CLAUDE_CODE_SESSION_TTL: { type: 'number', default: 86400000, description: 'Session TTL in ms (default 24h)' },
    CLAUDE_CODE_AUTO_SAVE: { type: 'boolean', default: true, description: 'Auto-save sessions' },

    // Extended: Logging
    CLAUDE_CODE_LOG_LEVEL: { type: 'string', default: 'info', description: 'Log level (debug/info/warn/error)' },
    CLAUDE_CODE_LOG_FILE: { type: 'string', description: 'Log file path' },

    // Extended: Hooks
    CLAUDE_CODE_HOOK_TIMEOUT: { type: 'number', default: 10000, description: 'Hook execution timeout in ms' },
    CLAUDE_CODE_HOOK_FAIL_OPEN: { type: 'boolean', default: true, description: 'Allow on hook failure' },

    // Extended: Context
    CLAUDE_CODE_COMPACT_THRESHOLD: { type: 'number', default: 0.8, description: 'Context compaction threshold (0-1)' },
    CLAUDE_CODE_MAX_MESSAGES: { type: 'number', default: 200, description: 'Max messages in context' },

    // Extended: Cache
    CLAUDE_CODE_PROMPT_CACHE: { type: 'boolean', default: true, description: 'Enable prompt caching' },
    CLAUDE_CODE_CACHE_TTL: { type: 'number', default: 300000, description: 'Cache TTL in ms (default 5min)' },

    // Extended: Output
    CLAUDE_CODE_MAX_LINES: { type: 'number', default: 200, description: 'Max output lines for tools' },
    CLAUDE_CODE_TRUNCATE: { type: 'boolean', default: true, description: 'Truncate long outputs' },
    CLAUDE_CODE_JSON_OUTPUT: { type: 'boolean', default: false, description: 'Output JSON instead of text' },

    // Extended: Git
    CLAUDE_CODE_GIT_ENABLED: { type: 'boolean', default: true, description: 'Enable git operations' },
    CLAUDE_CODE_GIT_AUTO_COMMIT: { type: 'boolean', default: false, description: 'Auto-commit changes' },

    // Extended: Editor
    EDITOR: { type: 'string', description: 'Default text editor' },
    VISUAL: { type: 'string', description: 'Default visual editor' },

    // Extended: Language
    LANG: { type: 'string', description: 'System locale' },
    LC_ALL: { type: 'string', description: 'Locale override' },

    // Extended: CI/CD
    CI: { type: 'boolean', default: false, description: 'Running in CI environment' },
    GITHUB_ACTIONS: { type: 'boolean', default: false, description: 'Running in GitHub Actions' },
    GITLAB_CI: { type: 'boolean', default: false, description: 'Running in GitLab CI' },

    // Extended: Container
    CONTAINER: { type: 'boolean', default: false, description: 'Running in container' },
    DOCKER: { type: 'boolean', default: false, description: 'Running in Docker' },
    CODESPACE_NAME: { type: 'string', description: 'GitHub Codespace name' },

    // Extended: Notification
    CLAUDE_CODE_NOTIFY: { type: 'boolean', default: false, description: 'Enable desktop notifications' },
    CLAUDE_CODE_WEBHOOK_URL: { type: 'string', description: 'Webhook URL for notifications' },

    // Extended: Experimental
    CLAUDE_CODE_EXPERIMENTAL_MCP: { type: 'boolean', default: false, description: 'Enable experimental MCP features' },
    CLAUDE_CODE_EXPERIMENTAL_TOOLS: { type: 'boolean', default: false, description: 'Enable experimental tools' },
    CLAUDE_CODE_EXPERIMENTAL_VISION: { type: 'boolean', default: false, description: 'Enable vision/image support' },
    CLAUDE_CODE_EXPERIMENTAL_MEMORY: { type: 'boolean', default: false, description: 'Enable persistent memory' },

    // Extended: Worktree
    CLAUDE_CODE_WORKTREE_DIR: { type: 'string', description: 'Default worktree base directory' },
    CLAUDE_CODE_AUTO_WORKTREE: { type: 'boolean', default: false, description: 'Auto-create worktrees for branches' },

    // Extended: Notebook
    CLAUDE_CODE_NOTEBOOK_KERNEL: { type: 'string', default: 'python3', description: 'Default Jupyter kernel' },

    // Extended: LSP
    CLAUDE_CODE_LSP_ENABLED: { type: 'boolean', default: false, description: 'Enable LSP integration' },
    CLAUDE_CODE_LSP_PORT: { type: 'number', default: 0, description: 'LSP server port (0 = auto)' },

    // Extended: Timeouts
    CLAUDE_CODE_TOOL_TIMEOUT: { type: 'number', default: 120000, description: 'Tool execution timeout in ms' },
    CLAUDE_CODE_API_TIMEOUT: { type: 'number', default: 300000, description: 'API call timeout in ms' },
    CLAUDE_CODE_MCP_TIMEOUT: { type: 'number', default: 30000, description: 'MCP operation timeout in ms' },

    // Extended: Permissions (additional)
    CLAUDE_CODE_ALLOWED_TOOLS: { type: 'string', description: 'Comma-separated list of allowed tools' },
    CLAUDE_CODE_DISALLOWED_TOOLS: { type: 'string', description: 'Comma-separated list of disallowed tools' },

    // Extended: Telemetry (additional)
    CLAUDE_CODE_TELEMETRY_ENDPOINT: { type: 'string', description: 'Custom telemetry endpoint URL' },
    CLAUDE_CODE_SENTRY_DSN: { type: 'string', description: 'Sentry DSN for error reporting' },
};

/**
 * Read and normalize all environment variables.
 * @returns {object} normalized env config
 */
export function readEnv() {
    const env = {};

    for (const [key, schema] of Object.entries(ENV_SCHEMA)) {
        const raw = process.env[key];
        if (raw === undefined) {
            if (schema.default !== undefined) {
                env[key] = schema.default;
            }
            continue;
        }

        switch (schema.type) {
            case 'boolean':
                env[key] = raw === '1' || raw === 'true' || raw === 'yes';
                break;
            case 'number':
                env[key] = parseInt(raw, 10);
                if (isNaN(env[key])) env[key] = schema.default;
                break;
            default:
                env[key] = raw;
        }
    }

    return env;
}

/**
 * Get a specific env var with type coercion.
 * @param {string} key
 * @param {*} [defaultValue]
 */
export function getEnv(key, defaultValue) {
    const schema = ENV_SCHEMA[key];
    const raw = process.env[key];

    if (raw === undefined) return defaultValue ?? schema?.default;

    if (schema?.type === 'boolean') return raw === '1' || raw === 'true';
    if (schema?.type === 'number') {
        const n = parseInt(raw, 10);
        return isNaN(n) ? defaultValue : n;
    }
    return raw;
}

/**
 * List all supported env vars with their current values.
 */
export function listEnvVars() {
    const result = [];
    for (const [key, schema] of Object.entries(ENV_SCHEMA)) {
        const value = process.env[key];
        result.push({
            key,
            type: schema.type,
            value: value || undefined,
            default: schema.default,
            description: schema.description,
            isSet: value !== undefined,
        });
    }
    return result;
}
