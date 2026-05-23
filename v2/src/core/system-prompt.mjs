/**
 * System Prompt Builder — loads and merges CLAUDE.md files.
 *
 * Features:
 * - Loads CLAUDE.md from: ~/.claude/CLAUDE.md, project root, parent dirs
 * - Merges in order (global -> project -> local)
 * - Splits at cache boundary (static prefix cached, dynamic suffix not)
 * - Includes tool schemas in the system prompt
 * - Exports buildWorkspaceSnapshot for injecting a file-tree into prompts
 * - Exports buildWorkspaceContent for injecting key file contents into prompts
 *   (used for thinking models that cannot make live tool calls)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

// Directories to skip when building the workspace snapshot.
const SNAPSHOT_EXCLUDE = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
    '__pycache__', '.cache', 'coverage', '.nyc_output', '.turbo',
]);

// Dot-files/dirs are hidden by default; these are shown because they are
// commonly checked into source control and useful for project analysis.
const SNAPSHOT_INCLUDE_DOTFILES = new Set([
    '.env.example', '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml',
    '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yml',
    '.babelrc', '.babelrc.js', '.gitignore', '.dockerignore', '.editorconfig',
]);

/**
 * Build a compact, indented directory tree for a workspace.
 *
 * The tree is capped at `maxFiles` entries so it never bloats the prompt.
 * Directories that match SNAPSHOT_EXCLUDE are skipped entirely.
 * Any I/O error returns an empty string gracefully.
 *
 * @param {string} [cwd] - root directory to scan (defaults to process.cwd())
 * @param {number} [maxFiles=200] - maximum number of entries to include
 * @returns {string} indented tree string, or '' on error / empty workspace
 */
export function buildWorkspaceSnapshot(cwd = process.cwd(), maxFiles = 200) {
    const lines = [];
    let count = 0;

    function walk(dir, indent) {
        if (count >= maxFiles) return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        // Directories first, then files, both sorted alphabetically
        entries.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        for (const entry of entries) {
            if (count >= maxFiles) {
                lines.push(indent + '… (truncated)');
                return;
            }
            if (SNAPSHOT_EXCLUDE.has(entry.name)) continue;
            if (entry.name.startsWith('.') && !SNAPSHOT_INCLUDE_DOTFILES.has(entry.name)) continue;
            lines.push(indent + entry.name + (entry.isDirectory() ? '/' : ''));
            count++;
            if (entry.isDirectory()) {
                walk(path.join(dir, entry.name), indent + '  ');
            }
        }
    }

    try {
        walk(path.resolve(cwd), '');
    } catch {
        return '';
    }

    return lines.join('\n');
}

// Priority-ordered list of project meta/config files to read for thinking models.
// These give the model the most structural insight per token spent.
const CONTENT_PRIORITY_FILES = [
    // Documentation
    'README.md', 'readme.md', 'README.txt',
    // Package / dependency manifests
    'package.json', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'setup.cfg',
    'go.mod', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile',
    // Entry points
    'index.js', 'index.mjs', 'index.ts', 'main.js', 'main.mjs', 'main.ts',
    'main.py', '__main__.py', 'app.py', 'app.js', 'app.ts',
    'src/index.js', 'src/index.mjs', 'src/index.ts',
    'src/main.js', 'src/main.mjs', 'src/main.ts', 'src/main.py',
    // Config
    'CLAUDE.md', '.claude/CLAUDE.md',
    'tsconfig.json', '.eslintrc.json', '.prettierrc.json',
    'Makefile', 'Dockerfile',
];

/**
 * Build a rich workspace context string that includes:
 * 1. The compact file-tree snapshot (always)
 * 2. Contents of high-value project files (README, package.json, entry points, etc.)
 *
 * This is intended for thinking models (e.g. Kimi K2.5, DeepSeek R1) that cannot
 * make live tool calls. By providing actual file contents up front, the model can
 * give accurate, project-specific answers without needing tool access.
 *
 * @param {string} [cwd] - workspace root (defaults to process.cwd())
 * @param {object} [opts]
 * @param {number} [opts.maxFileBytes=8192]  - max bytes to include per file
 * @param {number} [opts.maxTotalBytes=65536] - hard cap on total injected content
 * @returns {{ tree: string, files: Array<{path: string, content: string}>, summary: string }}
 */
export function buildWorkspaceContent(cwd = process.cwd(), opts = {}) {
    const { maxFileBytes = 8192, maxTotalBytes = 65536 } = opts;
    const root = path.resolve(cwd);

    // 1. Build the file tree
    const tree = buildWorkspaceSnapshot(root);

    // 2. Collect priority file contents
    const files = [];
    let totalBytes = 0;

    for (const rel of CONTENT_PRIORITY_FILES) {
        if (totalBytes >= maxTotalBytes) break;
        const abs = path.join(root, rel);
        if (!fs.existsSync(abs)) continue;
        try {
            const stat = fs.statSync(abs);
            if (!stat.isFile()) continue;
            let content = fs.readFileSync(abs, 'utf-8');
            const originalLength = content.length;
            if (originalLength > maxFileBytes) {
                content = content.slice(0, maxFileBytes) + `\n... (truncated — ${originalLength - maxFileBytes} more bytes)`;
            }
            const contentLength = content.length;
            if (totalBytes + contentLength > maxTotalBytes) break;
            files.push({ path: rel, content });
            totalBytes += contentLength;
        } catch { /* skip unreadable */ }
    }

    // 3. Build the formatted summary string
    const parts = [];

    if (tree) {
        parts.push('## Workspace file structure\n\n```\n' + tree + '\n```');
    }

    for (const { path: filePath, content } of files) {
        parts.push(`## File: ${filePath}\n\n\`\`\`\n${content}\n\`\`\``);
    }

    return {
        tree,
        files,
        summary: parts.join('\n\n'),
    };
}

/**
 * Build the system prompt text for thinking models (Kimi K2.5, DeepSeek R1).
 *
 * Unlike the standard system prompt (which instructs the model to call tools),
 * this version acknowledges that no tools are available and instead points the
 * model to the pre-injected workspace content below the prompt.
 *
 * @param {string} staticBase - the static prefix of the normal system prompt
 * @param {string} workspaceSummary - output of buildWorkspaceContent().summary
 * @returns {string}
 */
export function buildThinkingModelSystemPrompt(staticBase, workspaceSummary) {
    const header = [
        `You are an AI coding assistant with access to a snapshot of the user's workspace.`,
        ``,
        `IMPORTANT: You are operating in thinking mode. Live tool calls (Read, Write, Bash, Grep, etc.)`,
        `are NOT available in this session. Instead, a snapshot of the key project files and the`,
        `complete workspace file tree has been embedded below. Use this snapshot to answer questions`,
        `accurately and in full — never say you cannot see the project or ask the user to paste code.`,
        ``,
        `When the snapshot does not contain a file the user mentions, say so clearly and offer to`,
        `reason from the available context.`,
    ].join('\n');

    const parts = [header];
    if (staticBase) parts.push(staticBase);
    if (workspaceSummary) parts.push('---\n\n# Workspace snapshot (read-only)\n\n' + workspaceSummary);
    return parts.join('\n\n');
}

/**
 * Load all CLAUDE.md files and merge them in order.
 * @param {string} [cwd] - current working directory
 * @returns {string[]} Array of CLAUDE.md contents in merge order
 */
export function loadClaudeMdFiles(cwd = process.cwd()) {
    const files = [];

    // 1. Global: ~/.claude/CLAUDE.md
    const globalPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    if (fs.existsSync(globalPath)) {
        try {
            files.push({ source: 'global', content: fs.readFileSync(globalPath, 'utf-8') });
        } catch { /* skip */ }
    }

    // 2. Walk from cwd up to root, collecting CLAUDE.md files
    const projectFiles = [];
    let dir = path.resolve(cwd);
    const root = path.parse(dir).root;
    while (dir !== root) {
        const candidates = [
            path.join(dir, 'CLAUDE.md'),
            path.join(dir, '.claude', 'CLAUDE.md'),
        ];
        for (const f of candidates) {
            if (fs.existsSync(f)) {
                try {
                    projectFiles.push({ source: dir, content: fs.readFileSync(f, 'utf-8'), path: f });
                } catch { /* skip */ }
            }
        }
        dir = path.dirname(dir);
    }

    // Reverse so parent dirs come first (global -> project -> local)
    projectFiles.reverse();
    files.push(...projectFiles);

    return files;
}

/**
 * Build the full system prompt from CLAUDE.md files and tool schemas.
 * @param {object} options
 * @param {string} [options.cwd] - current working directory
 * @param {Array} [options.tools] - tool definitions for schema inclusion
 * @param {string} [options.override] - override system prompt entirely
 * @param {string[]} [options.addDirs] - additional directories to search for CLAUDE.md
 * @returns {{ staticPrefix: string, dynamicSuffix: string, full: string }}
 */
export function buildSystemPrompt({ cwd, tools, override, addDirs } = {}) {
    if (override) {
        return { staticPrefix: override, dynamicSuffix: '', full: override };
    }

    const workspaceRoot = path.resolve(cwd || process.cwd());
    const basePreamble = [
        `You are an AI coding assistant with direct access to the user's workspace on disk.`,
        `Current working directory: ${workspaceRoot}`,
        ``,
        `## Workspace exploration rules`,
        ``,
        `- When the user asks about their project, code, or files, ALWAYS use your tools to`,
        `  explore the workspace first — do NOT ask the user to paste or share anything.`,
        `- Use LS / Glob to discover files, Read to inspect their contents, Grep to search`,
        `  for patterns, and Bash to run commands (tests, builds, linters, git log, etc.).`,
        `- Start broad (list the root directory) then drill into relevant subdirectories.`,
        `- Prefer reading the actual source over guessing from file names alone.`,
        `- Never say "I don't see any files" or ask the user to share code — you can read`,
        `  the workspace directly with your tools.`,
    ].join('\n');

    const parts = [basePreamble];

    // Load CLAUDE.md files
    const mdFiles = loadClaudeMdFiles(cwd);

    // Add additional directories
    if (addDirs) {
        for (const dir of addDirs) {
            const p = path.join(dir, 'CLAUDE.md');
            if (fs.existsSync(p)) {
                try {
                    mdFiles.push({ source: dir, content: fs.readFileSync(p, 'utf-8') });
                } catch { /* skip */ }
            }
        }
    }

    for (const f of mdFiles) {
        parts.push(f.content);
    }

    // The static prefix is the base prompt + CLAUDE.md content (cacheable)
    const staticPrefix = parts.join('\n\n');

    // Dynamic suffix includes tool schemas (changes per-request)
    let dynamicSuffix = '';
    if (tools && tools.length > 0) {
        const toolSummary = tools.map(t =>
            `- ${t.name}: ${(t.description || '').slice(0, 100)}`
        ).join('\n');
        dynamicSuffix = `\n\nAvailable tools:\n${toolSummary}`;
    }

    return {
        staticPrefix,
        dynamicSuffix,
        full: staticPrefix + dynamicSuffix,
    };
}

/**
 * Convert system prompt to Anthropic cache-control format.
 * @param {string} staticPrefix
 * @param {string} dynamicSuffix
 * @returns {Array} system blocks with cache_control
 */
export function toCacheBlocks(staticPrefix, dynamicSuffix) {
    const blocks = [];

    if (staticPrefix) {
        blocks.push({
            type: 'text',
            text: staticPrefix,
            cache_control: { type: 'ephemeral' },
        });
    }

    if (dynamicSuffix) {
        blocks.push({
            type: 'text',
            text: dynamicSuffix,
        });
    }

    return blocks;
}
