#!/usr/bin/env node
/**
 * agent-bridge.mjs
 *
 * Long-lived subprocess that runs the Open Claude Code agent loop and
 * communicates with the VSCode extension over stdin/stdout using
 * newline-delimited JSON (ndjson).
 *
 * Protocol (stdin → bridge):
 *   {"type":"run",   "message":"<user text>"}
 *   {"type":"reset"}
 *   {"type":"model", "model":"<model name>"}
 *
 * Protocol (bridge → stdout):
 *   {"type":"stream_event",          "text":"..."}
 *   {"type":"assistant",             "content":"..."}
 *   {"type":"tool_progress",         "tool":"Bash","status":"running"}
 *   {"type":"result",                "tool":"Bash","result":"..."}
 *   {"type":"thinking",              "text":"..."}
 *   {"type":"compaction",            "count":1}
 *   {"type":"hookPermissionResult",  "tool":"...","allowed":false}
 *   {"type":"stop",                  "reason":"end_turn"}
 *   {"type":"error",                 "message":"..."}
 *   {"type":"ready"}
 *
 * Environment variables consumed:
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEY,
 *   NVIDIA_API_KEY
 *   ANTHROPIC_MODEL          — initial model override
 *   CLAUDE_CODE_PERMISSION_MODE
 *   CLAUDE_CODE_MAX_TURNS
 *
 * v2/src resolution:
 *   When installed from a VSIX the v2 source is bundled inside the extension
 *   directory as ./v2/src (copied by the prepackage script).
 *   When running from source (development / F5) ../v2/src is used instead.
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { existsSync } from 'fs';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Locate v2/src at runtime so the bridge works in both packaged and dev modes.
// ---------------------------------------------------------------------------
function findV2Src() {
    const candidates = [
        path.join(__dirname, 'v2', 'src'),        // installed from VSIX (bundled)
        path.join(__dirname, '..', 'v2', 'src'),  // development — sibling directory
    ];
    for (const candidate of candidates) {
        if (existsSync(path.join(candidate, 'core', 'agent-loop.mjs'))) {
            return candidate;
        }
    }
    throw new Error(
        'Cannot locate v2/src. Checked:\n' +
        candidates.map(c => '  ' + c).join('\n') + '\n' +
        'Run `npm run package` from the vscode-extension/ directory to bundle the source.'
    );
}

const V2_SRC = findV2Src();
const v2url  = (rel) => pathToFileURL(path.join(V2_SRC, rel)).href;

// Dynamic imports — resolved against the path found above.
const { createAgentLoop }      = await import(v2url('core/agent-loop.mjs'));
const { createToolRegistry }   = await import(v2url('tools/registry.mjs'));
const { createPermissionChecker } = await import(v2url('permissions/checker.mjs'));
const { loadSettings }         = await import(v2url('config/settings.mjs'));
const { HookEngine }           = await import(v2url('hooks/engine.mjs'));
const { AgentLoader }          = await import(v2url('agents/loader.mjs'));
const { SkillsLoader }         = await import(v2url('skills/loader.mjs'));

// Redirect console.error/warn to stderr so we don't pollute the ndjson stream.
// (It already goes to stderr by default, but belt-and-suspenders.)
const originalStderr = process.stderr.write.bind(process.stderr);

function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

async function init() {
    let settings;
    try {
        settings = await loadSettings();
    } catch (err) {
        emit({ type: 'error', message: `Failed to load settings: ${err.message}` });
        process.exit(1);
    }

    const tools = createToolRegistry();
    const permissions = createPermissionChecker(settings.permissions);
    const hooks = new HookEngine(settings.hooks || {});

    // Load agents and skills
    const agentLoader = new AgentLoader();
    agentLoader.load();
    const skillsLoader = new SkillsLoader();
    skillsLoader.load();

    const skillTool = tools.get('Skill');
    if (skillTool) skillTool._skillsLoader = skillsLoader;

    const loop = createAgentLoop({
        model: settings.model || 'claude-sonnet-4-6',
        tools,
        permissions,
        settings,
        hooks,
    });

    loop.state._agentLoader = agentLoader;
    loop.state._skillsLoader = skillsLoader;
    loop.state._hooks = settings.hooks;
    loop.state._permissionMode = settings.permissions?.defaultMode || 'default';

    emit({ type: 'ready' });

    // ── Message loop ────────────────────────────────────────────────────────
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

    // Serialize requests so they never interleave.
    let queue = Promise.resolve();

    rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let msg;
        try {
            msg = JSON.parse(trimmed);
        } catch {
            emit({ type: 'error', message: `Bad JSON from extension: ${trimmed}` });
            return;
        }

        if (msg.type === 'reset') {
            queue = queue.then(() => handleReset(loop));
        } else if (msg.type === 'run') {
            queue = queue.then(() => handleRun(loop, msg.message));
        } else if (msg.type === 'model') {
            queue = queue.then(() => handleModelSwitch(loop, msg.model));
        } else if (msg.type === 'resume') {
            queue = queue.then(() => handleResume(loop, msg.messages || []));
        }
    });

    rl.on('close', () => process.exit(0));
}

async function handleRun(loop, message) {
    if (!message || typeof message !== 'string') {
        emit({ type: 'error', message: 'run message must have a non-empty "message" string' });
        emit({ type: 'stop', reason: 'error' });
        return;
    }
    try {
        for await (const event of loop.run(message)) {
            emit(event);
        }
    } catch (err) {
        emit({ type: 'error', message: err.message });
        emit({ type: 'stop', reason: 'error' });
    }
}

async function handleReset(loop) {
    loop.state.messages = [];
    loop.state.turnCount = 0;
    loop.state.tokenUsage = { input: 0, output: 0 };
    emit({ type: 'ready' });
}

async function handleModelSwitch(loop, model) {
    if (model && typeof model === 'string') {
        loop.state.model = model;
    }
    emit({ type: 'ready' });
}

/**
 * Restore conversation history into the agent loop so the model remembers
 * the full session from the beginning (like Claude Premium session memory).
 *
 * UI messages (type:'user'/'assistant', text:'...') are converted to the
 * API message format used by the agent loop.
 */
async function handleResume(loop, messages) {
    loop.state.messages = messages
        .filter(m => (m.type === 'user' || m.type === 'assistant') && m.text)
        .map(m => {
            if (m.type === 'user') {
                return { role: 'user', content: m.text };
            }
            // Assistant messages use content-block array format for API compatibility
            return { role: 'assistant', content: [{ type: 'text', text: m.text }] };
        });
    loop.state.turnCount = messages.filter(m => m.type === 'user').length;
    // Token usage is reset to zero because the stored messages contain only plain
    // text (not the original API token counts). The stats bar will show usage for
    // new turns going forward; this is correct and expected behaviour on resume.
    loop.state.tokenUsage = { input: 0, output: 0 };
    emit({ type: 'ready' });
}

init().catch((err) => {
    emit({ type: 'error', message: err.message });
    process.exit(1);
});
