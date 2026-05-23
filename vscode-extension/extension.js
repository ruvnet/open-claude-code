'use strict';
/**
 * extension.js — Open Claude Code VSCode Extension
 *
 * Provides two interfaces:
 *
 * 1. Custom Webview Panel (Cursor-style sidebar)
 *    - Activity bar icon → dedicated chat panel
 *    - Rich HTML/CSS/JS UI with markdown, syntax highlighting, code apply, @file mentions
 *    - Streaming token display, tool visualization, model/mode switching
 *
 * 2. Chat Participant (@claude) — kept for backwards compatibility
 *    - Forwards messages to the shared agent-bridge subprocess
 *
 * Commands:
 *   Open Claude Code: Set API Key
 *   Open Claude Code: Clear Session
 *   Open Claude Code: Show Status
 *   Open Claude Code: Open Chat Panel
 *   Open Claude Code: Apply Code to Active File
 */

const vscode = require('vscode');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PARTICIPANT_ID = 'open-claude-code.claude';
const BRIDGE_SCRIPT  = path.join(__dirname, 'agent-bridge.mjs');
// Maximum number of user/assistant messages kept in a persisted session.
// Applies to both the in-progress activeSession and updated history entries.
const MAX_SESSION_MESSAGES = 200;

// ── Rate-limit retry ─────────────────────────────────────────────────────────
/** Backoff delays (ms) for successive retry attempts */
const RETRY_DELAYS_MS = [3000, 8000, 20000];

/**
 * Returns true when the error message looks like a transient rate-limit /
 * server-overload error that is worth retrying automatically.
 * @param {string} msg
 */
function isRateLimitError(msg) {
    return /rate.?limit|overload|too.?many.?request|capacity|529|503|quota/i.test(msg || '');
}

// ── AgentBridge ─────────────────────────────────────────────────────────────

/**
 * Manages a single long-lived agent-bridge.mjs child process.
 * Serializes requests so concurrent messages don't interleave.
 */
class AgentBridge {
    constructor(cwd, env) {
        this._cwd  = cwd;
        this._env  = env;
        this._proc = null;
        this._lineBuffer = '';
        this._currentHandler = null;
        this._queue  = Promise.resolve();
        this._started = false;
    }

    start() {
        if (this._started) return;
        this._started = true;

        this._proc = spawn(process.execPath, [BRIDGE_SCRIPT], {
            cwd:   this._cwd,
            env:   { ...process.env, ...this._env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this._proc.stdout.setEncoding('utf8');
        this._proc.stdout.on('data', (chunk) => {
            this._lineBuffer += chunk;
            const lines = this._lineBuffer.split('\n');
            this._lineBuffer = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) this._dispatch(trimmed);
            }
        });

        this._proc.stderr.setEncoding('utf8');
        this._proc.stderr.on('data', (data) => {
            console.error('[open-claude-code bridge]', data.trim());
        });

        this._proc.on('exit', (code, signal) => {
            this._started = false;
            const handler = this._currentHandler;
            this._currentHandler = null;
            if (handler) {
                const hint = 'Click Retry to continue — your session memory will be restored.';
                const reason = signal
                    ? `signal=${signal}`
                    : `exit code ${code}`;
                handler({
                    type: 'error',
                    message: `Agent process stopped unexpectedly (${reason}). ${hint}`,
                });
            }
        });
    }

    _dispatch(line) {
        let event;
        try { event = JSON.parse(line); } catch {
            console.error('[open-claude-code bridge] bad JSON:', line);
            return;
        }
        if (this._currentHandler) this._currentHandler(event);
    }

    run(message, onEvent) {
        // Use the two-arg form of .then() so a rejected queue resolves before
        // attempting the new run (prevents a stuck queue after bridge errors).
        this._queue = this._queue.then(
            () => this._doRun(message, onEvent),
            () => this._doRun(message, onEvent),
        );
        return this._queue;
    }

    _doRun(message, onEvent) {
        return new Promise((resolve) => {
            this._currentHandler = (event) => {
                onEvent(event);
                if (event.type === 'stop' || event.type === 'error') {
                    this._currentHandler = null;
                    resolve();
                }
            };
            if (!this._send({ type: 'run', message })) {
                this._currentHandler = null;
                onEvent({ type: 'error', message: 'Agent bridge is not running.' });
                onEvent({ type: 'stop',  reason: 'error' });
                resolve();
            }
        });
    }

    reset() {
        this._queue = this._queue.then(
            () => new Promise((resolve) => {
                this._currentHandler = (event) => {
                    if (event.type === 'ready' || event.type === 'error') {
                        this._currentHandler = null;
                        resolve();
                    }
                };
                if (!this._send({ type: 'reset' })) {
                    this._currentHandler = null;
                    resolve();
                }
            })
        );
        return this._queue;
    }

    switchModel(model) {
        this._queue = this._queue.then(
            () => new Promise((resolve) => {
                this._currentHandler = (event) => {
                    if (event.type === 'ready' || event.type === 'error') {
                        this._currentHandler = null;
                        resolve();
                    }
                };
                if (!this._send({ type: 'model', model })) {
                    this._currentHandler = null;
                    resolve();
                }
            })
        );
        return this._queue;
    }

    /**
     * Restore conversation history into the agent loop so the model remembers
     * the full session from the beginning (Claude Premium-style session memory).
     */
    resume(messages) {
        this._queue = this._queue.then(
            () => new Promise((resolve) => {
                this._currentHandler = (event) => {
                    if (event.type === 'ready' || event.type === 'error') {
                        this._currentHandler = null;
                        resolve();
                    }
                };
                if (!this._send({ type: 'resume', messages })) {
                    // Bridge not running — skip gracefully; a new bridge will be
                    // created with auto-injected history by getBridge().
                    this._currentHandler = null;
                    resolve();
                }
            })
        );
        return this._queue;
    }

    /**
     * Write a JSON message to the bridge's stdin.
     * Returns true on success, false if the bridge is not running or write fails.
     * Never throws so callers can use a simple boolean check.
     */
    _send(obj) {
        if (!this._proc || !this._started) return false;
        try {
            this._proc.stdin.write(JSON.stringify(obj) + '\n');
            return true;
        } catch {
            return false;
        }
    }

    get isRunning() { return this._started && !!this._proc; }

    dispose() {
        if (this._proc) {
            this._proc.stdin.end();
            this._proc.kill();
            this._proc = null;
        }
        this._started = false;
    }
}

// ── Extension state ──────────────────────────────────────────────────────────

/** @type {AgentBridge | null} */
let bridge = null;

/** @type {vscode.ExtensionContext | null} */
let extensionContext = null;

/** @type {ClaudeCodeViewProvider | null} */
let viewProvider = null;

async function getBridge() {
    if (bridge && bridge.isRunning) return bridge;

    const config = vscode.workspace.getConfiguration('openClaudeCode');
    const model          = config.get('model')          || 'claude-sonnet-4-6';
    const permissionMode = config.get('permissionMode') || 'default';

    const anthropicKey =
        (await extensionContext.secrets.get('openClaudeCode.apiKey')) ||
        process.env.ANTHROPIC_API_KEY || '';
    const openaiKey  = process.env.OPENAI_API_KEY  || '';
    const googleKey  = process.env.GOOGLE_API_KEY  || process.env.GEMINI_API_KEY || '';
    const nvidiaKey  = config.get('nvidiaApiKey') || process.env.NVIDIA_API_KEY  || '';

    const env = {};
    if (anthropicKey) env.ANTHROPIC_API_KEY  = anthropicKey;
    if (openaiKey)    env.OPENAI_API_KEY     = openaiKey;
    if (googleKey)    env.GOOGLE_API_KEY     = googleKey;
    if (nvidiaKey)    env.NVIDIA_API_KEY     = nvidiaKey;
    env.ANTHROPIC_MODEL              = model;
    env.CLAUDE_CODE_PERMISSION_MODE  = permissionMode;
    env.CLAUDE_CODE_MAX_TURNS        = String(config.get('maxTurns') || 20);
    env.NVIDIA_THINKING_MODE         = String(config.get('nvidiaThinkingMode') || false);

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    bridge = new AgentBridge(cwd, env);
    bridge.start();

    // ── Auto-restore session memory ─────────────────────────────────────────
    // Whenever a fresh bridge is created (after a crash, settings change, or
    // VS Code restart) inject the last active session so the model always
    // remembers the full conversation without the user having to do anything.
    // This is queued before any subsequent run() call so history is always
    // loaded before the first user message is processed.
    const savedSession = extensionContext
        ? extensionContext.globalState.get('openClaudeCode.activeSession')
        : null;
    if (savedSession?.messages?.length > 0) {
        bridge.resume(savedSession.messages);
    }

    return bridge;
}

// ── ClaudeCodeViewProvider (Webview sidebar) ─────────────────────────────────

class ClaudeCodeViewProvider {
    constructor(context) {
        this._context = context;
        this._view = null;
        this._isCancelled = false;
        this._tokenUsage = { input: 0, output: 0 };
        this._cost = 0;
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._context.extensionUri, 'media'),
            ],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (msg) => this._handleWebviewMessage(msg),
            null,
            this._context.subscriptions
        );
    }

    postMessage(msg) {
        if (this._view) {
            this._view.webview.postMessage(msg);
        }
    }

    async _handleWebviewMessage(msg) {
        switch (msg.type) {
            case 'ready': {
                const config = vscode.workspace.getConfiguration('openClaudeCode');
                const hasApiKey = !!(
                    (await extensionContext.secrets.get('openClaudeCode.apiKey')) ||
                    process.env.ANTHROPIC_API_KEY ||
                    process.env.OPENAI_API_KEY ||
                    process.env.GOOGLE_API_KEY ||
                    process.env.GEMINI_API_KEY ||
                    process.env.NVIDIA_API_KEY ||
                    config.get('nvidiaApiKey')
                );
                // Restore any active session persisted before the last VS Code restart
                const activeSession = this._context.globalState.get('openClaudeCode.activeSession');
                const activeMessages = (activeSession && Array.isArray(activeSession.messages) && activeSession.messages.length > 0)
                    ? activeSession.messages : null;
                // Also restore the session ID so continued messages update the right history entry
                const activeSessionId = (activeSession && activeSession.sessionId) || null;
                this.postMessage({
                    type: 'initialized',
                    model: config.get('model') || 'claude-sonnet-4-6',
                    mode:  config.get('permissionMode') || 'default',
                    thinkingMode: !!config.get('nvidiaThinkingMode'),
                    autoAttachActiveFile: !!config.get('autoAttachActiveFile'),
                    hasApiKey,
                    activeSession: activeMessages,
                    activeSessionId,
                });
                break;
            }

            case 'runCommand': {
                if (msg.command) {
                    vscode.commands.executeCommand(msg.command, ...(msg.args || []));
                }
                break;
            }

            case 'send': {
                await this._runPrompt(msg.message, msg.contextFiles, msg.fileRefs);
                break;
            }

            case 'clear': {
                if (bridge && bridge.isRunning) await bridge.reset();
                this._tokenUsage = { input: 0, output: 0 };
                this._cost = 0;
                this.postMessage({ type: 'sessionCleared' });
                break;
            }

            case 'cancel': {
                this._isCancelled = true;
                break;
            }

            case 'model': {
                const config = vscode.workspace.getConfiguration('openClaudeCode');
                await config.update('model', msg.model, vscode.ConfigurationTarget.Global);
                if (bridge && bridge.isRunning) await bridge.switchModel(msg.model);
                this.postMessage({ type: 'modelChanged', model: msg.model });
                break;
            }

            case 'mode': {
                const config = vscode.workspace.getConfiguration('openClaudeCode');
                await config.update('permissionMode', msg.mode, vscode.ConfigurationTarget.Global);
                if (bridge) { bridge.dispose(); bridge = null; }
                break;
            }

            case 'thinkingMode': {
                const config = vscode.workspace.getConfiguration('openClaudeCode');
                await config.update('nvidiaThinkingMode', !!msg.enabled, vscode.ConfigurationTarget.Global);
                // Restart bridge so NVIDIA_THINKING_MODE env var is re-read
                if (bridge) { bridge.dispose(); bridge = null; }
                this.postMessage({ type: 'thinkingModeChanged', enabled: !!msg.enabled });
                break;
            }

            case 'applyCode': {
                await this._applyCodeToActiveEditor(msg.code, msg.language);
                break;
            }

            case 'applyCodeToFile': {
                await this._applyCodeWithFilePicker(msg.code, msg.language);
                break;
            }

            case 'copyToClipboard': {
                await vscode.env.clipboard.writeText(msg.text || '');
                break;
            }

            case 'pickFile': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Add to context',
                });
                if (uris && uris[0]) {
                    await this._addFileToContext(uris[0].fsPath);
                }
                break;
            }

            case 'addContextFile': {
                if (msg.path) await this._addFileToContext(msg.path);
                break;
            }

            case 'fileSearch': {
                const results = await this._searchFiles(msg.query || '');
                this.postMessage({ type: 'fileSearchResults', files: results });
                break;
            }

            case 'saveSession': {
                if (msg.messages && msg.messages.length > 0) {
                    const sessions = this._context.globalState.get('openClaudeCode.chatHistory', []);
                    const firstUser = msg.messages.find(m => m.type === 'user');
                    const title = firstUser
                        ? firstUser.text.slice(0, 80).replace(/\n/g, ' ')
                        : 'Untitled conversation';
                    sessions.unshift({
                        id: Date.now().toString(),
                        title,
                        createdAt: Date.now(),
                        messages: msg.messages,
                    });
                    // Keep the 30 most recent sessions
                    if (sessions.length > 30) sessions.length = 30;
                    await this._context.globalState.update('openClaudeCode.chatHistory', sessions);
                }
                break;
            }

            case 'getHistory': {
                const sessions = this._context.globalState.get('openClaudeCode.chatHistory', []);
                const sessionList = sessions.map(s => ({
                    id: s.id,
                    title: s.title,
                    createdAt: s.createdAt,
                    messageCount: s.messages ? s.messages.length : 0,
                }));
                this.postMessage({ type: 'historyData', sessions: sessionList });
                break;
            }

            case 'loadSession': {
                const sessions = this._context.globalState.get('openClaudeCode.chatHistory', []);
                const session = sessions.find(s => s.id === msg.id);
                if (session) {
                    // Include id so the webview can track which session is being viewed
                    this.postMessage({ type: 'sessionData', id: session.id, messages: session.messages || [] });
                }
                break;
            }

            case 'resumeFromHistory': {
                // Direct-resume (Cursor-style): load and immediately switch to a history session.
                const sessions = this._context.globalState.get('openClaudeCode.chatHistory', []);
                const session = sessions.find(s => s.id === msg.id);
                if (session) {
                    this.postMessage({ type: 'resumeFromHistoryData', id: session.id, messages: session.messages || [] });
                }
                break;
            }

            case 'updateSession': {
                // Update an existing history entry (after adding new messages to a resumed session).
                const sessions = this._context.globalState.get('openClaudeCode.chatHistory', []);
                const sess = sessions.find(s => s.id === msg.id);
                if (sess && Array.isArray(msg.messages) && msg.messages.length > 0) {
                    sess.messages = msg.messages.slice(-MAX_SESSION_MESSAGES);
                    sess.messageCount = sess.messages.length;
                    const firstUser = sess.messages.find(m => m.type === 'user');
                    if (firstUser) sess.title = firstUser.text.slice(0, 80).replace(/\n/g, ' ');
                    await this._context.globalState.update('openClaudeCode.chatHistory', sessions);
                }
                break;
            }

            case 'renameSession': {
                const sessions = this._context.globalState.get('openClaudeCode.chatHistory', []);
                const sess = sessions.find(s => s.id === msg.id);
                if (sess && msg.title) {
                    sess.title = String(msg.title).slice(0, 120);
                    await this._context.globalState.update('openClaudeCode.chatHistory', sessions);
                    const sessionList = sessions.map(s => ({
                        id: s.id, title: s.title, createdAt: s.createdAt,
                        messageCount: s.messages ? s.messages.length : 0,
                    }));
                    this.postMessage({ type: 'historyData', sessions: sessionList });
                }
                break;
            }

            case 'deleteSession': {
                let sessions = this._context.globalState.get('openClaudeCode.chatHistory', []);
                sessions = sessions.filter(s => s.id !== msg.id);
                await this._context.globalState.update('openClaudeCode.chatHistory', sessions);
                const sessionList = sessions.map(s => ({
                    id: s.id, title: s.title, createdAt: s.createdAt,
                    messageCount: s.messages ? s.messages.length : 0,
                }));
                this.postMessage({ type: 'historyData', sessions: sessionList });
                break;
            }

            case 'autoSaveSession': {
                // Persist the current in-progress session so it survives VS Code restarts.
                // Called by the webview after every completed response (stop event).
                if (msg.messages && msg.messages.length > 0) {
                    // Cap at 200 messages (individual user/assistant entries) to avoid
                    // unbounded growth of the active session storage. This is separate
                    // from the 30-session cap on the chat history archive.
                    const capped = msg.messages.slice(-MAX_SESSION_MESSAGES);
                    await this._context.globalState.update('openClaudeCode.activeSession', {
                        messages: capped,
                        // Track which history session this is so it can be updated on restart
                        sessionId: msg.sessionId || null,
                        savedAt: Date.now(),
                    });
                } else {
                    await this._context.globalState.update('openClaudeCode.activeSession', null);
                }
                break;
            }

            case 'resumeSession': {
                // Restore conversation history into the agent bridge so the model
                // remembers the full session (Claude Premium-style session memory).
                if (msg.messages && msg.messages.length > 0) {
                    try {
                        const agentBridge = await getBridge();
                        await agentBridge.resume(msg.messages);
                    } catch (err) {
                        this.postMessage({ type: 'error', message: 'Failed to resume session: ' + err.message });
                    }
                }
                break;
            }

            case 'exportConversation': {
                const content = String(msg.markdown || '');
                const defaultName = 'conversation-' + new Date().toISOString().slice(0, 10) + '.md';
                const defaultUri = vscode.Uri.file(
                    path.join(
                        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
                        defaultName
                    )
                );
                const uri = await vscode.window.showSaveDialog({
                    defaultUri,
                    filters: { 'Markdown': ['md'] },
                    title: 'Export conversation as Markdown',
                });
                if (uri) {
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                    vscode.window.showInformationMessage('Exported to ' + path.basename(uri.fsPath));
                }
                break;
            }

            case 'getActiveFileContent': {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    this.postMessage({
                        type: 'activeFileContent',
                        content: editor.document.getText(),
                        fileName: path.basename(editor.document.fileName),
                    });
                } else {
                    this.postMessage({ type: 'activeFileContent', content: null, fileName: null });
                }
                break;
            }

            case 'getPinnedFiles': {
                const config = vscode.workspace.getConfiguration('openClaudeCode');
                const pinned = (config.get('pinnedFiles') || []).filter(p => {
                    try { return fs.existsSync(p); } catch { return false; }
                });
                this.postMessage({
                    type: 'pinnedFiles',
                    files: pinned.map(p => ({ name: path.basename(p), path: p })),
                });
                break;
            }

            case 'pinFile': {
                const config = vscode.workspace.getConfiguration('openClaudeCode');
                const pinned = [...(config.get('pinnedFiles') || [])];
                if (msg.path && !pinned.includes(msg.path)) {
                    pinned.push(msg.path);
                    await config.update('pinnedFiles', pinned, vscode.ConfigurationTarget.Global);
                }
                break;
            }

            case 'unpinFile': {
                const config = vscode.workspace.getConfiguration('openClaudeCode');
                const pinned = (config.get('pinnedFiles') || []).filter(p => p !== msg.path);
                await config.update('pinnedFiles', pinned, vscode.ConfigurationTarget.Global);
                break;
            }

            case 'runInTerminal': {
                // Send shell code directly to the integrated terminal.
                // Reuse an existing "Claude Code" terminal if one is already open.
                const code = String(msg.code || '').trim();
                if (!code) break;
                let terminal = vscode.window.terminals.find(t => t.name === 'Claude Code');
                if (!terminal) {
                    terminal = vscode.window.createTerminal({ name: 'Claude Code' });
                }
                terminal.show(true); // true = preserve editor focus
                terminal.sendText(code);
                break;
            }

            case 'addActiveFile': {
                // Add the currently active editor file to the webview context chips.
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const filePath = editor.document.fileName;
                    const fileName = path.basename(filePath);
                    this.postMessage({
                        type: 'fileContent',
                        name: fileName,
                        path: filePath,
                    });
                } else {
                    vscode.window.showInformationMessage('No active editor — open a file first.');
                }
                break;
            }

            case 'getGitContext': {
                const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!cwd) {
                    this.postMessage({ type: 'gitContext', content: '(no workspace folder open)', branch: '' });
                    break;
                }
                const run = (args) => new Promise((resolve) => {
                    execFile('git', args, { cwd, timeout: 5000 }, (err, stdout) => {
                        resolve(err ? '' : stdout.trim());
                    });
                });
                const [branch, status, diffStat] = await Promise.all([
                    run(['rev-parse', '--abbrev-ref', 'HEAD']),
                    run(['status', '--short']),
                    run(['diff', '--stat']),
                ]);
                const parts = [];
                if (branch) parts.push(`Branch: ${branch}`);
                parts.push(status ? `Changed files:\n${status}` : 'Working tree clean');
                if (diffStat) parts.push(`Diff summary:\n${diffStat}`);
                this.postMessage({ type: 'gitContext', content: parts.join('\n\n'), branch: branch || '' });
                break;
            }

            case 'getWorkspaceDiagnostics': {
                const diags = [];
                for (const [uri, ds] of vscode.languages.getDiagnostics()) {
                    const rel = vscode.workspace.asRelativePath(uri);
                    for (const d of ds) {
                        if (d.severity > 1) continue; // skip hints and info
                        diags.push({
                            file: rel,
                            line: d.range.start.line + 1,
                            col:  d.range.start.character + 1,
                            severity: d.severity === 0 ? 'error' : 'warning',
                            message: d.message,
                            source: d.source || '',
                        });
                    }
                }
                diags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
                this.postMessage({ type: 'workspaceDiagnostics', diagnostics: diags });
                break;
            }

            case 'getOpenEditors': {
                const files = [];
                const seen = new Set();
                for (const group of (vscode.window.tabGroups?.all || [])) {
                    for (const tab of group.tabs) {
                        const uri = tab.input?.uri;
                        if (uri && !seen.has(uri.fsPath)) {
                            seen.add(uri.fsPath);
                            files.push({
                                name: path.basename(uri.fsPath),
                                path: uri.fsPath,
                                relativePath: vscode.workspace.asRelativePath(uri.fsPath),
                            });
                        }
                    }
                }
                this.postMessage({ type: 'openEditors', files });
                break;
            }

            case 'toggleAutoAttach': {
                const config = vscode.workspace.getConfiguration('openClaudeCode');
                const next = !config.get('autoAttachActiveFile');
                await config.update('autoAttachActiveFile', next, vscode.ConfigurationTarget.Global);
                this.postMessage({ type: 'autoAttachState', enabled: next });
                break;
            }

            default:
                break;
        }
    }

    async _runPrompt(message, contextFilePaths, fileRefs) {
        this._isCancelled = false;

        let fullPrompt = message;

        // Inject context file contents
        const allPaths = new Set(contextFilePaths || []);
        if (fileRefs && fileRefs.length > 0) {
            const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (ws) {
                for (const ref of fileRefs) {
                    const abs = path.resolve(ws, ref);
                    if (fs.existsSync(abs)) allPaths.add(abs);
                }
            }
        }

        // Auto-attach active editor when the setting is on (works even if no
        // other context files were explicitly added by the user).
        const promptConfig = vscode.workspace.getConfiguration('openClaudeCode');
        if (promptConfig.get('autoAttachActiveFile')) {
            const editor = vscode.window.activeTextEditor;
            if (editor) allPaths.add(editor.document.fileName);
        }

        if (allPaths.size > 0) {
            const fileContents = [];
            for (const fp of allPaths) {
                try {
                    const content = fs.readFileSync(fp, 'utf8');
                    const rel = vscode.workspace.asRelativePath(fp);
                    fileContents.push('\n\n--- File: ' + rel + ' ---\n' + content);
                } catch {
                    // skip unreadable files
                }
            }
            if (fileContents.length > 0) {
                fullPrompt = message + '\n\n[Context files:]' + fileContents.join('');
            }
        }

        let agentBridge;
        try {
            agentBridge = await getBridge();
        } catch (err) {
            this.postMessage({ type: 'error', message: 'Failed to start agent: ' + err.message });
            this.postMessage({ type: 'stop' });
            return;
        }

        // ── Retry loop (auto-recovers from rate-limit / overload errors) ────────
        for (let attempt = 0; ; attempt++) {
            if (this._isCancelled) return;

            let retryErrorMsg = null;

            await agentBridge.run(fullPrompt, (event) => {
                if (this._isCancelled) return;
                // Intercept retryable errors — don't forward yet; we may recover
                if (event.type === 'error' && isRateLimitError(event.message)) {
                    retryErrorMsg = event.message;
                    return;
                }
                this.postMessage(event);
            });

            if (this._isCancelled) return;

            if (!retryErrorMsg) {
                // Normal completion — stop was already forwarded by onEvent
                this.postMessage({ type: 'stop' });
                return;
            }

            // Retryable error — decide whether to retry or give up
            if (attempt >= RETRY_DELAYS_MS.length) {
                // All retries exhausted
                this.postMessage({
                    type: 'error',
                    message: retryErrorMsg + ` (failed after ${attempt + 1} attempts)`,
                });
                this.postMessage({ type: 'stop' });
                return;
            }

            const delaySec = Math.ceil(RETRY_DELAYS_MS[attempt] / 1000);
            this.postMessage({
                type: 'retrying',
                attempt: attempt + 1,
                delaySeconds: delaySec,
                maxAttempts: RETRY_DELAYS_MS.length,
            });

            // Countdown ticks emitted every second so the UI can show a live timer
            await new Promise((resolve) => {
                let remaining = delaySec - 1;
                const tick = setInterval(() => {
                    if (this._isCancelled) { clearInterval(tick); resolve(); return; }
                    if (remaining <= 0) { clearInterval(tick); resolve(); return; }
                    this.postMessage({
                        type: 'retrying',
                        attempt: attempt + 1,
                        delaySeconds: remaining,
                        maxAttempts: RETRY_DELAYS_MS.length,
                    });
                    remaining--;
                }, 1000);
            });

            if (this._isCancelled) return;

            // Re-acquire bridge in case it restarted during the wait
            try {
                agentBridge = await getBridge();
            } catch (err) {
                this.postMessage({ type: 'error', message: 'Failed to restart agent: ' + err.message });
                this.postMessage({ type: 'stop' });
                return;
            }
        }
    }

    async _applyCodeToActiveEditor(code) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor. Open a file first.');
            return;
        }
        await editor.edit((editBuilder) => {
            if (!editor.selection.isEmpty) {
                editBuilder.replace(editor.selection, code);
            } else {
                const lastLine = editor.document.lineCount - 1;
                const lastChar = editor.document.lineAt(lastLine).text.length;
                const end = new vscode.Position(lastLine, lastChar);
                editBuilder.insert(end, '\n' + code);
            }
        });
        await vscode.commands.executeCommand('workbench.action.files.save');
        vscode.window.showInformationMessage('Code applied to ' + path.basename(editor.document.fileName));
    }

    async _applyCodeWithFilePicker(code, language) {
        const ext = languageToExt(language);
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Apply to this file',
            filters: ext ? { [language || 'code']: [ext] } : undefined,
        });
        if (!uris || !uris[0]) return;

        const doc = await vscode.workspace.openTextDocument(uris[0]);
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit((eb) => {
            const fullRange = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length)
            );
            eb.replace(fullRange, code);
        });
        await vscode.commands.executeCommand('workbench.action.files.save');
    }

    async _addFileToContext(filePath) {
        const name = path.basename(filePath);
        this.postMessage({ type: 'fileContent', path: filePath, name });
    }

    async _searchFiles(query) {
        const pattern = query ? ('**/*' + query + '*') : '**/*';
        const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 20);
        return uris.map((u) => ({
            name:         path.basename(u.fsPath),
            path:         u.fsPath,
            relativePath: vscode.workspace.asRelativePath(u.fsPath),
        }));
    }

    _getHtmlForWebview(webview) {
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'media', 'chat.css')
        );
        const jsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'media', 'chat.js')
        );

        const templatePath = path.join(this._context.extensionPath, 'media', 'chat.html');
        let html = fs.readFileSync(templatePath, 'utf8');

        const nonce = generateNonce();
        const csp = [
            "default-src 'none'",
            "style-src " + webview.cspSource + " 'unsafe-inline'",
            "script-src 'nonce-" + nonce + "'",
            "img-src " + webview.cspSource + " data: https:",
            "font-src " + webview.cspSource,
        ].join('; ');

        html = html
            .replace('<!--CSP_PLACEHOLDER-->', '<meta http-equiv="Content-Security-Policy" content="' + csp + '">')
            .replace('<!--CSS_URI-->', cssUri.toString())
            .replace(/<!--JS_URI-->/g, jsUri.toString())
            .replace('<script src="' + jsUri + '">', '<script nonce="' + nonce + '" src="' + jsUri + '">');

        return html;
    }
}

ClaudeCodeViewProvider.viewType = 'claudeCode.chatView';

function generateNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function languageToExt(lang) {
    const map = {
        javascript: 'js', typescript: 'ts', python: 'py', java: 'java',
        go: 'go', rust: 'rs', cpp: 'cpp', c: 'c', html: 'html', css: 'css',
        json: 'json', yaml: 'yaml', markdown: 'md', shell: 'sh', bash: 'sh',
    };
    return map[(lang || '').toLowerCase()];
}

// ── Chat Participant (kept for backwards-compatibility) ──────────────────────

async function handleChatRequest(request, _context, stream, token) {
    const config = vscode.workspace.getConfiguration('openClaudeCode');
    const showToolOutput = config.get('showToolOutput') !== false;

    if (request.command === 'clear') {
        if (bridge && bridge.isRunning) await bridge.reset();
        stream.markdown('🗑️ Session cleared. Starting a fresh conversation.');
        return;
    }

    if (request.command === 'model') {
        const modelArg = request.prompt.trim();
        if (!modelArg) {
            stream.markdown('Usage: `@claude /model <model-name>`\n\nExamples:\n- `claude-sonnet-4-6`\n- `claude-opus-4-6`\n- `claude-haiku-4-5`');
            return;
        }
        if (bridge && bridge.isRunning) await bridge.switchModel(modelArg);
        stream.markdown('✅ Switched model to `' + modelArg + '`.');
        return;
    }

    const userMessage = request.prompt.trim();
    if (!userMessage) { stream.markdown('Please enter a message.'); return; }

    let agentBridge;
    try {
        agentBridge = await getBridge();
    } catch (err) {
        stream.markdown('❌ Failed to start agent: ' + err.message + '\n\nMake sure you have set your API key with the **Open Claude Code: Set API Key** command.');
        return;
    }

    let pendingText = '';
    function flushText() {
        if (pendingText) { stream.markdown(pendingText); pendingText = ''; }
    }

    await agentBridge.run(userMessage, (event) => {
        if (token.isCancellationRequested) return;
        switch (event.type) {
            case 'stream_event':    pendingText += event.text || ''; break;
            case 'assistant':       if (event.content && !event._streamed) pendingText += event.content; break;
            case 'thinking':        break;
            case 'tool_progress':
                if (showToolOutput) { flushText(); stream.progress('⚙️ Running tool: ' + event.tool); }
                break;
            case 'result':
                if (showToolOutput && event.result !== undefined) {
                    flushText();
                    const preview = String(event.result).slice(0, 400);
                    const truncated = String(event.result).length > 400 ? '…' : '';
                    stream.markdown('\n```\n' + preview + truncated + '\n```\n');
                }
                break;
            case 'compaction':
                flushText();
                stream.markdown('\n> ℹ️ Context compacted (pass ' + event.count + ')\n');
                break;
            case 'hookPermissionResult':
                if (!event.allowed) { flushText(); stream.markdown('\n> ⛔ Tool blocked by hook: `' + event.tool + '`\n'); }
                break;
            case 'error':   flushText(); stream.markdown('\n❌ **Error:** ' + event.message); break;
            case 'stop':    flushText(); break;
            default: break;
        }
    });

    flushText();
}

// ── Activation / deactivation ────────────────────────────────────────────────

function activate(context) {
    extensionContext = context;

    // Sidebar webview panel
    viewProvider = new ClaudeCodeViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ClaudeCodeViewProvider.viewType,
            viewProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Chat participant (@claude)
    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handleChatRequest);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    context.subscriptions.push(participant);

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('openClaudeCode.setApiKey', async () => {
            const key = await vscode.window.showInputBox({
                prompt: 'Enter your API key for Anthropic (sk-ant-...), OpenAI (sk-...) or any other provider',
                password: true,
                placeHolder: 'sk-ant-api03-... or sk-... or nvapi-...',
                validateInput: (v) => (v && v.trim().length > 10) ? null : 'API key must be at least 10 characters (e.g. sk-ant-..., sk-..., nvapi-...)',
            });
            if (key) {
                await context.secrets.store('openClaudeCode.apiKey', key.trim());
                if (bridge) { bridge.dispose(); bridge = null; }
                vscode.window.showInformationMessage('API key saved. Bridge will restart on next message.');
                // Notify webview so it can hide the setup guide
                if (viewProvider) {
                    viewProvider.postMessage({ type: 'apiKeySet' });
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('openClaudeCode.clearSession', async () => {
            if (bridge && bridge.isRunning) {
                await bridge.reset();
                if (viewProvider) viewProvider.postMessage({ type: 'sessionCleared' });
                vscode.window.showInformationMessage('Open Claude Code session cleared.');
            } else {
                vscode.window.showInformationMessage('No active session to clear.');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('openClaudeCode.showStatus', async () => {
            const config = vscode.workspace.getConfiguration('openClaudeCode');
            const model          = config.get('model') || 'claude-sonnet-4-6';
            const permissionMode = config.get('permissionMode') || 'default';
            const hasKey = !!(
                (await context.secrets.get('openClaudeCode.apiKey')) ||
                process.env.ANTHROPIC_API_KEY
            );
            const status = (bridge && bridge.isRunning) ? '🟢 running' : '⚪ idle';
            vscode.window.showInformationMessage(
                'Open Claude Code — bridge: ' + status +
                ' | model: ' + model +
                ' | permission: ' + permissionMode +
                ' | API key: ' + (hasKey ? '✅ set' : '❌ missing')
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('openClaudeCode.openChat', () => {
            vscode.commands.executeCommand('claudeCode.chatView.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('openClaudeCode.applyCode', async () => {
            const code = await vscode.window.showInputBox({
                prompt: 'Paste code to apply to the active editor',
                placeHolder: '// paste code here',
            });
            if (code && viewProvider) {
                await viewProvider._applyCodeToActiveEditor(code);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('openClaudeCode.inlineEdit', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Open Claude Code: No active editor for inline edit.');
                return;
            }
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection.isEmpty ? undefined : selection);
            const fileName = path.basename(editor.document.fileName);
            await vscode.commands.executeCommand('claudeCode.chatView.focus');
            if (viewProvider) {
                viewProvider.postMessage({
                    type: 'inlineEditRequest',
                    selectedText,
                    fileName,
                    hasSelection: !selection.isEmpty,
                });
            }
        })
    );

    // Reload bridge when settings change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('openClaudeCode')) {
                if (bridge) { bridge.dispose(); bridge = null; }
            }
        })
    );
}

function deactivate() {
    if (bridge) { bridge.dispose(); bridge = null; }
}

module.exports = { activate, deactivate };
