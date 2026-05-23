/**
 * Agent Loop — async generator yielding 13 event types.
 * Handles streaming, tool calls, thinking, auto-compaction, hooks, multi-provider.
 */
import { streamResponse, accumulateStream } from './streaming.mjs';
import { ContextManager } from './context-manager.mjs';
import { buildSystemPrompt, buildWorkspaceSnapshot, buildWorkspaceContent, buildThinkingModelSystemPrompt } from './system-prompt.mjs';
import { isNvidiaModel } from './providers.mjs';
import fs from 'fs';
import path from 'path';

/**
 * NVIDIA NIM models that CAN use chat_template_kwargs.thinking=true for
 * extended reasoning — but only when NVIDIA_THINKING_MODE=true is set.
 *
 * By default (NVIDIA_THINKING_MODE unset / false) these models work in
 * standard tool-calling mode: Read, Write, Bash, Grep, etc. all work.
 *
 * When NVIDIA_THINKING_MODE=true the thinking flag is added and tools are
 * omitted (NVIDIA NIM rejects the combination), falling back to workspace
 * snapshot injection.
 */
const NVIDIA_THINKING_CAPABLE_MODELS = new Set([
    'moonshotai/kimi-k2.5',
    'deepseek-ai/deepseek-r1',
]);

export function createAgentLoop({ model, tools, permissions, settings, hooks }) {
    const contextManager = new ContextManager(settings.maxContextTokens || 180000);

    // Build system prompt using the new builder
    const promptResult = buildSystemPrompt({
        cwd: process.cwd(),
        tools: tools.list?.() || [],
        override: settings.systemPromptOverride,
        addDirs: settings.addDirs,
    });

    const state = {
        messages: [],
        systemPrompt: promptResult.full,
        systemPromptStatic: promptResult.staticPrefix,  // tool-free prefix for providers that don't use tools
        turnCount: 0,
        tokenUsage: { input: 0, output: 0 },
        model,
        tools,
        _contextManager: contextManager,
    };

    async function* run(userMessage, options = {}) {
        // Add user message (skip for continuation turns)
        if (userMessage && !options.continuation) {
            state.messages = contextManager.addMessage(state.messages, {
                role: 'user',
                content: userMessage,
            });
            state.turnCount++;
        }

        // Check max turns
        if (settings.maxTurns && state.turnCount > settings.maxTurns) {
            yield { type: 'error', message: `Max turns (${settings.maxTurns}) reached.` };
            yield { type: 'stop', reason: 'max_turns' };
            return;
        }

        // Auto-compact if needed
        if (contextManager.shouldCompact(state.messages)) {
            yield { type: 'compaction', count: contextManager.compactionCount + 1 };
            state.messages = contextManager.compact(state.messages);
        }

        yield { type: 'stream_request_start', turn: state.turnCount };

        // Detect provider and call API — read state.model so that model
        // switches (via handleModelSwitch) take effect on the next turn.
        const currentModel = state.model;
        const provider = detectProvider(currentModel);
        let response;

        try {
            if (settings.stream !== false) {
                // Streaming mode
                response = await callApiStreaming(provider, currentModel, state, tools.list(), settings);
                const collectedContent = [];
                let currentText = '';
                let currentThinking = '';

                for await (const event of response.events) {
                    if (event.type === 'content_block_start') {
                        if (event.content_block?.type === 'thinking') {
                            currentThinking = '';
                        }
                    } else if (event.type === 'content_block_delta') {
                        if (event.delta?.type === 'text_delta') {
                            currentText += event.delta.text;
                            yield { type: 'stream_event', text: event.delta.text };
                        } else if (event.delta?.type === 'thinking_delta') {
                            currentThinking += event.delta.thinking;
                            yield { type: 'thinking', text: event.delta.thinking };
                        }
                    } else if (event.type === 'ping') {
                        // Keepalive, ignore
                    }
                }

                // Use the accumulated message
                response = response.accumulated;
            } else {
                // Non-streaming mode
                response = await callApi(provider, currentModel, state, tools.list(), settings);
            }
        } catch (err) {
            yield { type: 'error', message: err.message };
            return;
        }

        // Track token usage
        if (response.usage) {
            state.tokenUsage.input += response.usage.input_tokens || 0;
            state.tokenUsage.output += response.usage.output_tokens || 0;
        }

        // Build assistant message for history
        const assistantMessage = { role: 'assistant', content: response.content };
        state.messages.push(assistantMessage);

        // Process content blocks
        const toolUseBlocks = [];

        for (const block of response.content || []) {
            if (block.type === 'text') {
                yield { type: 'assistant', content: block.text };
            }

            if (block.type === 'thinking') {
                yield { type: 'thinking_complete', thinking: block.thinking };
            }

            if (block.type === 'tool_use') {
                toolUseBlocks.push(block);
            }
        }

        // Process tool calls
        if (toolUseBlocks.length > 0) {
            const toolResults = [];

            for (const block of toolUseBlocks) {
                // Run pre-tool hooks
                if (hooks) {
                    const hookResult = await hooks.runPreToolUse(block.name, block.input);
                    if (!hookResult.allow) {
                        yield { type: 'hookPermissionResult', tool: block.name, allowed: false, message: hookResult.message };
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: block.id,
                            content: `Blocked by hook: ${hookResult.message}`,
                        });
                        continue;
                    }
                }

                // Check permission
                const allowed = await permissions.check(block.name, block.input);
                if (!allowed) {
                    yield { type: 'hookPermissionResult', tool: block.name, allowed: false };
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: 'Permission denied',
                    });
                    continue;
                }

                // Execute tool
                yield { type: 'tool_progress', tool: block.name, status: 'running' };

                let result;
                try {
                    result = await tools.call(block.name, block.input);
                } catch (err) {
                    result = `Tool error: ${err.message}`;
                }

                // Run post-tool hooks
                if (hooks) {
                    result = await hooks.runPostToolUse(block.name, result);
                }

                yield { type: 'result', tool: block.name, result };

                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: typeof result === 'string' ? result : JSON.stringify(result),
                });
            }

            // Add tool results as a single user message
            state.messages.push({ role: 'user', content: toolResults });

            // Recursive: continue the loop after tool execution
            yield* run(null, { continuation: true });
            return;
        }

        // No tool calls — check stop hooks
        if (hooks) {
            const allowStop = await hooks.runStop();
            if (!allowStop) {
                // Hook prevented stopping — continue with a nudge
                state.messages = contextManager.addMessage(state.messages, {
                    role: 'user',
                    content: '[System: A hook prevented stopping. Please continue with the task.]',
                });
                yield* run(null, { continuation: true });
                return;
            }
        }

        yield { type: 'stop', reason: response.stop_reason || 'end_turn' };
    }

    return { run, state };
}

function detectProvider(model) {
    if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
    if (model.startsWith('gemini')) return 'google';
    if (isNvidiaModel(model)) return 'nvidia';
    return 'anthropic';
}

async function callApi(provider, model, state, toolDefs, settings) {
    const callers = { anthropic: callAnthropic, openai: callOpenAI, google: callGoogle, nvidia: callNvidia };
    const caller = callers[provider] || callers.anthropic;
    return caller(model, state, toolDefs, settings, false);
}

async function callApiStreaming(provider, model, state, toolDefs, settings) {
    const callers = { anthropic: callAnthropic, openai: callOpenAI, google: callGoogle, nvidia: callNvidia };
    const caller = callers[provider] || callers.anthropic;
    return caller(model, state, toolDefs, settings, true);
}

async function callAnthropic(model, state, toolDefs, settings, stream) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const body = {
        model,
        max_tokens: settings.maxTokens || 16384,
        messages: state.messages,
        ...(state.systemPrompt && { system: state.systemPrompt }),
        ...(toolDefs.length > 0 && { tools: toolDefs }),
        ...(stream && { stream: true }),
    };

    // Enable extended thinking if model supports it
    if (model.includes('opus') || settings.thinking) {
        body.thinking = { type: 'enabled', budget_tokens: settings.thinkingBudget || 10000 };
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    if (stream) {
        const collected = [];
        const eventGenerator = async function* () {
            for await (const event of streamResponse(res)) {
                collected.push(event);
                yield event;
            }
        };
        return {
            events: eventGenerator(),
            get accumulated() {
                return accumulateFromCollected(collected);
            },
        };
    }

    return res.json();
}

async function callOpenAI(model, state, toolDefs, settings, stream) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');

    const messages = [];
    if (state.systemPrompt) {
        messages.push({ role: 'system', content: state.systemPrompt });
    }
    for (const msg of state.messages) {
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

    const tools = toolDefs.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const body = {
        model,
        messages,
        ...(tools.length > 0 && { tools }),
    };

    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return convertOpenAIResponse(data);
}

async function callGoogle(model, state, toolDefs, settings, stream) {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY not set');

    const contents = [];
    for (const msg of state.messages) {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        if (typeof msg.content === 'string') {
            contents.push({ role, parts: [{ text: msg.content }] });
        }
    }

    const body = {
        contents,
        ...(state.systemPrompt && {
            systemInstruction: { parts: [{ text: state.systemPrompt }] },
        }),
    };

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }
    );

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return convertGoogleResponse(data);
}

/**
 * NVIDIA NIM — OpenAI-compatible chat completions endpoint.
 *
 * Uses the same message format as OpenAI but targets
 * https://integrate.api.nvidia.com/v1/chat/completions.
 *
 * For thinking-capable models (kimi-k2.5, deepseek-r1) the
 * `chat_template_kwargs: { thinking: true }` parameter is added
 * automatically so the model returns its reasoning trace.
 *
 * Streaming uses the standard OpenAI SSE format (data: {...} / data: [DONE]).
 * The thinking content is surfaced as a "thinking" text block so the existing
 * agent-loop thinking display works without modification.
 */
async function callNvidia(model, state, toolDefs, settings, stream) {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) throw new Error('NVIDIA_API_KEY not set');

    // Thinking mode is opt-in: only enabled when NVIDIA_THINKING_MODE=true.
    // By default, capable models (kimi-k2.5, deepseek-r1) use standard
    // function-calling mode — tools work exactly as in any other provider.
    const thinkingEnabled = process.env.NVIDIA_THINKING_MODE === 'true';
    const supportsThinking = thinkingEnabled && NVIDIA_THINKING_CAPABLE_MODELS.has(model);

    // When thinking mode is active the tool-list suffix would be misleading
    // (NVIDIA NIM rejects tools + thinking together), so swap in a special
    // system prompt with a rich workspace snapshot instead.
    let systemPrompt = state.systemPrompt;
    if (supportsThinking) {
        if (!state.systemPromptStatic) {
            process.stderr.write('[open-claude-code] Warning: systemPromptStatic missing — falling back to full system prompt for ' + model + '\n');
        }
        const base = state.systemPromptStatic || state.systemPrompt;
        const workspaceContent = buildWorkspaceContent(process.cwd());
        systemPrompt = buildThinkingModelSystemPrompt(base, workspaceContent.summary);
    }
    const effectiveState = supportsThinking
        ? { ...state, systemPrompt }
        : state;

    // Build OpenAI-style messages
    const messages = buildOpenAIMessages(effectiveState);

    const body = {
        model,
        messages,
        max_tokens: settings.maxTokens || 16384,
        temperature: 1.00,
        top_p: 1.00,
        stream: !!stream,
        ...(supportsThinking && {
            chat_template_kwargs: { thinking: true },
        }),
        // Include tools unless thinking mode is active (NVIDIA NIM rejects
        // the combination of chat_template_kwargs.thinking + tools).
        ...(!supportsThinking && toolDefs.length > 0 && {
            tools: toolDefs.map(t => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.input_schema },
            })),
        }),
    };

    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`NVIDIA API error ${res.status}: ${err}`);
    }

    if (stream) {
        // Stream with the generic OpenAI-style SSE parser
        const collected = [];
        const eventGenerator = async function* () {
            for await (const event of streamOpenAIResponse(res)) {
                collected.push(event);
                yield event;
            }
        };
        return {
            events: eventGenerator(),
            get accumulated() {
                return accumulateOpenAIStream(collected);
            },
        };
    }

    const data = await res.json();
    return convertNvidiaResponse(data);
}

/**
 * Build an OpenAI-style messages array from agent loop state.
 * Handles system prompt, plain-text turns, and tool_result turns.
 */
function buildOpenAIMessages(state) {
    const messages = [];
    if (state.systemPrompt) {
        messages.push({ role: 'system', content: state.systemPrompt });
    }
    for (const msg of state.messages) {
        if (typeof msg.content === 'string') {
            messages.push({ role: msg.role, content: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (block.type === 'tool_result') {
                    messages.push({
                        role: 'tool',
                        tool_call_id: block.tool_use_id,
                        content: typeof block.content === 'string'
                            ? block.content
                            : JSON.stringify(block.content),
                    });
                } else if (block.type === 'text') {
                    messages.push({ role: msg.role, content: block.text });
                }
            }
        }
    }
    return messages;
}

/**
 * Convert a non-streaming NVIDIA response to the internal format.
 * NVIDIA NIM returns the same shape as OpenAI, but may include a
 * "thinking" field directly on the message for supported models.
 */
function convertNvidiaResponse(data) {
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No choices in NVIDIA response');

    const content = [];

    // Some NVIDIA models surface thinking as a separate message field
    const thinkingText = choice.message?.thinking || choice.message?.reasoning_content;
    if (thinkingText) {
        content.push({ type: 'thinking', thinking: thinkingText });
    }

    if (choice.message?.content) {
        content.push({ type: 'text', text: choice.message.content });
    }

    if (choice.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
            content.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: (() => {
                    try { return JSON.parse(tc.function.arguments || '{}'); } catch { return {}; }
                })(),
            });
        }
    }

    return {
        content,
        stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : (choice.finish_reason || 'end_turn'),
        usage: {
            input_tokens: data.usage?.prompt_tokens || 0,
            output_tokens: data.usage?.completion_tokens || 0,
        },
    };
}

/**
 * Parse an OpenAI-style SSE stream into events.
 * Each line has the format "data: {json}" or "data: [DONE]".
 * Thinking content in delta is surfaced as a synthetic
 * content_block_delta with type "thinking_delta" so the agent loop
 * can display it without changes.
 */
async function* streamOpenAIResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let thinkingBuffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete last line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === ':') continue;
                if (!trimmed.startsWith('data:')) continue;

                const raw = trimmed.slice(5).trim();
                if (raw === '[DONE]') {
                    yield { type: 'done' };
                    return;
                }

                let chunk;
                try { chunk = JSON.parse(raw); } catch { continue; }

                // Surface API errors returned inside the SSE stream (HTTP 200 with error body)
                if (chunk.error) {
                    throw new Error(chunk.error.message || JSON.stringify(chunk.error));
                }

                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;

                // Thinking token (deepseek-r1 / kimi-k2.5)
                const thinkingDelta = delta.reasoning_content || delta.thinking;
                if (thinkingDelta) {
                    thinkingBuffer += thinkingDelta;
                    yield {
                        type: 'content_block_delta',
                        delta: { type: 'thinking_delta', thinking: thinkingDelta },
                    };
                }

                // Regular text content
                if (delta.content) {
                    // If we have accumulated thinking, emit block boundaries once
                    if (thinkingBuffer) {
                        thinkingBuffer = '';
                    }
                    yield {
                        type: 'content_block_delta',
                        delta: { type: 'text_delta', text: delta.content },
                    };
                }

                // Tool calls
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        yield {
                            type: 'content_block_delta',
                            delta: {
                                type: 'tool_call_delta',
                                index: tc.index,
                                id: tc.id,
                                name: tc.function?.name,
                                partial_json: tc.function?.arguments || '',
                            },
                        };
                    }
                }

                // Finish reason
                const finishReason = chunk.choices?.[0]?.finish_reason;
                if (finishReason) {
                    yield {
                        type: 'message_delta',
                        delta: { stop_reason: finishReason === 'stop' ? 'end_turn' : finishReason },
                    };
                }
            }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith('data:')) {
                const raw = trimmed.slice(5).trim();
                if (raw && raw !== '[DONE]') {
                    try {
                        const chunk = JSON.parse(raw);
                        const delta = chunk.choices?.[0]?.delta;
                        if (delta?.content) {
                            yield {
                                type: 'content_block_delta',
                                delta: { type: 'text_delta', text: delta.content },
                            };
                        }
                    } catch {
                        // ignore malformed final chunk
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Accumulate streamed OpenAI-style events into an internal message object.
 */
function accumulateOpenAIStream(events) {
    const message = {
        content: [],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
    };

    let textContent = '';
    let thinkingContent = '';
    const toolCallMap = {}; // index -> { id, name, arguments }

    for (const event of events) {
        if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'thinking_delta') {
                thinkingContent += event.delta.thinking || '';
            } else if (event.delta?.type === 'text_delta') {
                textContent += event.delta.text || '';
            } else if (event.delta?.type === 'tool_call_delta') {
                const idx = event.delta.index ?? 0;
                if (!toolCallMap[idx]) {
                    toolCallMap[idx] = { id: event.delta.id || `call_${idx}`, name: event.delta.name || '', arguments: '' };
                }
                if (event.delta.name) toolCallMap[idx].name = event.delta.name;
                if (event.delta.id) toolCallMap[idx].id = event.delta.id;
                toolCallMap[idx].arguments += event.delta.partial_json || '';
            }
        } else if (event.type === 'message_delta') {
            if (event.delta?.stop_reason) message.stop_reason = event.delta.stop_reason;
        }
    }

    if (thinkingContent) {
        message.content.push({ type: 'thinking', thinking: thinkingContent });
    }
    if (textContent) {
        message.content.push({ type: 'text', text: textContent });
    }
    for (const tc of Object.values(toolCallMap)) {
        let input = {};
        try { input = JSON.parse(tc.arguments || '{}'); } catch { input = {}; }
        message.content.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
    }

    if (!message.stop_reason) message.stop_reason = 'end_turn';
    return message;
}

function convertOpenAIResponse(data) {
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
}

function convertGoogleResponse(data) {
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
}

function accumulateFromCollected(events) {
    const message = {
        content: [],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
    };

    let currentBlock = null;

    for (const event of events) {
        switch (event.type) {
            case 'message_start':
                if (event.message?.usage) {
                    message.usage.input_tokens = event.message.usage.input_tokens || 0;
                }
                break;
            case 'content_block_start':
                currentBlock = { ...event.content_block };
                if (currentBlock.type === 'text') currentBlock.text = '';
                if (currentBlock.type === 'thinking') currentBlock.thinking = '';
                if (currentBlock.type === 'tool_use') currentBlock.input = '';
                message.content.push(currentBlock);
                break;
            case 'content_block_delta':
                if (!currentBlock) break;
                if (event.delta?.type === 'text_delta') currentBlock.text += event.delta.text;
                else if (event.delta?.type === 'thinking_delta') currentBlock.thinking += event.delta.thinking;
                else if (event.delta?.type === 'input_json_delta') currentBlock.input += event.delta.partial_json;
                break;
            case 'content_block_stop':
                if (currentBlock?.type === 'tool_use' && typeof currentBlock.input === 'string') {
                    try { currentBlock.input = JSON.parse(currentBlock.input || '{}'); } catch { currentBlock.input = {}; }
                }
                currentBlock = null;
                break;
            case 'message_delta':
                if (event.delta?.stop_reason) message.stop_reason = event.delta.stop_reason;
                if (event.usage) message.usage.output_tokens = event.usage.output_tokens || 0;
                break;
            case 'ping':
                break;
        }
    }

    return message;
}
