/**
 * Multi-Provider — unified provider config and request/response transforms.
 *
 * Supports: Anthropic, OpenAI, Google, NVIDIA, Bedrock (stub), Vertex (stub).
 * Each provider defines endpoint, auth headers, and optional transforms.
 */

const PROVIDERS = {
    anthropic: {
        name: 'Anthropic',
        endpoint: 'https://api.anthropic.com/v1/messages',
        envKey: 'ANTHROPIC_API_KEY',
        authHeader(key) {
            return {
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
            };
        },
        models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6'],
    },

    openai: {
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        envKey: 'OPENAI_API_KEY',
        authHeader(key) {
            return {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
            };
        },
        models: ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o1-mini', 'o3-mini'],
        transformRequest(body) {
            const messages = [];
            if (body.system) {
                messages.push({ role: 'system', content: body.system });
            }
            for (const msg of body.messages || []) {
                if (typeof msg.content === 'string') {
                    messages.push({ role: msg.role, content: msg.content });
                } else if (Array.isArray(msg.content)) {
                    for (const block of msg.content) {
                        if (block.type === 'tool_result') {
                            messages.push({
                                role: 'tool',
                                tool_call_id: block.tool_use_id,
                                content: block.content,
                            });
                        }
                    }
                }
            }

            const tools = (body.tools || []).map(t => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.input_schema },
            }));

            return {
                model: body.model,
                messages,
                ...(tools.length > 0 && { tools }),
                ...(body.max_tokens && { max_tokens: body.max_tokens }),
                ...(body.stream && { stream: true }),
            };
        },
        transformResponse(data) {
            const choice = data.choices?.[0];
            if (!choice) throw new Error('No choices in OpenAI response');

            const content = [];
            if (choice.message?.content) {
                content.push({ type: 'text', text: choice.message.content });
            }
            if (choice.message?.tool_calls) {
                for (const tc of choice.message.tool_calls) {
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function.name,
                        input: JSON.parse(tc.function.arguments || '{}'),
                    });
                }
            }

            return {
                content,
                stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason,
                usage: {
                    input_tokens: data.usage?.prompt_tokens || 0,
                    output_tokens: data.usage?.completion_tokens || 0,
                },
            };
        },
    },

    google: {
        name: 'Google',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
        envKey: 'GOOGLE_API_KEY',
        altEnvKey: 'GEMINI_API_KEY',
        authHeader(key) {
            return { 'Content-Type': 'application/json' };
        },
        models: ['gemini-2.0-flash', 'gemini-2.0-pro', 'gemini-1.5-flash'],
        transformRequest(body) {
            const contents = [];
            for (const msg of body.messages || []) {
                const role = msg.role === 'assistant' ? 'model' : 'user';
                if (typeof msg.content === 'string') {
                    contents.push({ role, parts: [{ text: msg.content }] });
                }
            }

            return {
                contents,
                ...(body.system && {
                    systemInstruction: { parts: [{ text: body.system }] },
                }),
            };
        },
        transformResponse(data) {
            const candidate = data.candidates?.[0];
            if (!candidate) throw new Error('No candidates in Google response');

            const content = [];
            for (const part of candidate.content?.parts || []) {
                if (part.text) content.push({ type: 'text', text: part.text });
            }

            return {
                content,
                stop_reason: 'end_turn',
                usage: {
                    input_tokens: data.usageMetadata?.promptTokenCount || 0,
                    output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
                },
            };
        },
    },

    /**
     * NVIDIA NIM — OpenAI-compatible endpoint hosted at integrate.api.nvidia.com.
     *
     * Supported models include:
     *   moonshotai/kimi-k2.5          — Kimi K2.5 with extended thinking
     *   nvidia/llama-3.1-nemotron-70b-instruct
     *   meta/llama-3.1-405b-instruct
     *   meta/llama-3.3-70b-instruct
     *   mistralai/mistral-large-2-instruct
     *   mistralai/mixtral-8x22b-instruct-v0.1
     *   google/gemma-3-27b-it
     *   deepseek-ai/deepseek-r1
     *
     * Auth: Bearer token via NVIDIA_API_KEY environment variable.
     * Endpoint: https://integrate.api.nvidia.com/v1/chat/completions
     * Streaming: OpenAI-style SSE (data: {...} lines ending with data: [DONE]).
     */
    nvidia: {
        name: 'NVIDIA NIM',
        endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
        envKey: 'NVIDIA_API_KEY',
        authHeader(key) {
            return {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
            };
        },
        models: [
            'moonshotai/kimi-k2.5',
            'nvidia/llama-3.1-nemotron-70b-instruct',
            'meta/llama-3.1-405b-instruct',
            'meta/llama-3.3-70b-instruct',
            'mistralai/mistral-large-2-instruct',
            'mistralai/mixtral-8x22b-instruct-v0.1',
            'google/gemma-3-27b-it',
            'deepseek-ai/deepseek-r1',
        ],
        /** Models that support extended thinking via chat_template_kwargs */
        thinkingModels: ['moonshotai/kimi-k2.5', 'deepseek-ai/deepseek-r1'],
    },

    bedrock: {
        name: 'AWS Bedrock',
        endpoint: null, // Dynamic based on region
        envKey: 'AWS_ACCESS_KEY_ID',
        models: ['anthropic.claude-3-sonnet', 'anthropic.claude-3-haiku'],
        authHeader() {
            // AWS SigV4 signing would go here
            return { 'Content-Type': 'application/json' };
        },
        getEndpoint(model, region = 'us-east-1') {
            return `https://bedrock-runtime.${region}.amazonaws.com/model/${model}/invoke`;
        },
    },

    vertex: {
        name: 'Google Vertex AI',
        endpoint: null, // Dynamic based on project/region
        envKey: 'GOOGLE_APPLICATION_CREDENTIALS',
        models: ['claude-sonnet-4-6@anthropic'],
        authHeader() {
            // GCP bearer token would go here
            return { 'Content-Type': 'application/json' };
        },
        getEndpoint(model, project, region = 'us-central1') {
            return `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/anthropic/models/${model}:rawPredict`;
        },
    },
};

/**
 * Get the provider configuration for a given model.
 * @param {string} model - model name
 * @returns {object} provider config
 */
export function getProvider(model) {
    if (model.startsWith('claude') || model.startsWith('anthropic')) return PROVIDERS.anthropic;
    if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return PROVIDERS.openai;
    if (model.startsWith('gemini')) return PROVIDERS.google;
    // NVIDIA-hosted models use a namespaced format: "publisher/model-name"
    if (isNvidiaModel(model)) return PROVIDERS.nvidia;
    return PROVIDERS.anthropic; // default
}

/**
 * Return true when the model ID belongs to the NVIDIA NIM catalogue.
 * NVIDIA models use the format "publisher/model-name".
 */
export function isNvidiaModel(model) {
    if (!model || !model.includes('/')) return false;
    const [publisher] = model.split('/');
    const nvidiaPublishers = new Set([
        'moonshotai', 'nvidia', 'meta', 'mistralai', 'google',
        'deepseek-ai', 'microsoft', 'qwen', 'baichuan-inc',
    ]);
    return nvidiaPublishers.has(publisher);
}

/**
 * Get a provider by name.
 * @param {string} name
 * @returns {object|undefined}
 */
export function getProviderByName(name) {
    return PROVIDERS[name];
}

/**
 * List all supported providers.
 * @returns {Array<{ name: string, envKey: string, models: string[] }>}
 */
export function listProviders() {
    return Object.entries(PROVIDERS).map(([key, p]) => ({
        id: key,
        name: p.name,
        envKey: p.envKey,
        models: p.models || [],
        hasEndpoint: !!p.endpoint,
    }));
}

/**
 * Check which providers have API keys configured.
 * @returns {Array<{ id: string, name: string, configured: boolean }>}
 */
export function checkProviderKeys() {
    return Object.entries(PROVIDERS).map(([key, p]) => ({
        id: key,
        name: p.name,
        configured: !!(process.env[p.envKey] || (p.altEnvKey && process.env[p.altEnvKey])),
    }));
}

export { PROVIDERS };
