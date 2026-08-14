/**
 * Bash Tool — matches Claude Code's exact behavior.
 *
 * Features:
 * - Timeout with SIGTERM -> SIGKILL escalation
 * - run_in_background option
 * - description parameter
 * - 1MB output limit
 * - ANSI code stripping by default
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Strip ANSI escape sequences
function stripAnsi(str) {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB

function getBashExecutable() {
    if (process.platform !== 'win32') return 'bash';

    const candidates = [
        process.env.GIT_BASH_PATH,
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    ].filter(Boolean);

    return candidates.find(candidate => fs.existsSync(candidate)) || 'bash.exe';
}

const bashExecutable = getBashExecutable();

export const BashTool = {
    name: 'Bash',
    description: 'Execute a bash command and return its output.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'The command to execute' },
            timeout: { type: 'number', description: 'Timeout in ms (max 600000)', default: 120000 },
            description: { type: 'string', description: 'Description of what this command does' },
            run_in_background: { type: 'boolean', description: 'Run in background', default: false },
        },
        required: ['command'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.command) errors.push('command is required');
        return errors;
    },
    async call(input) {
        const timeout = Math.min(input.timeout || 120000, 600000);

        if (input.run_in_background) {
            return runBackground(input.command);
        }

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let killed = false;
            let exitCode = null;

            const proc = spawn(bashExecutable, ['-c', input.command], {
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 0, // we handle timeout ourselves
            });

            proc.stdout.on('data', (chunk) => {
                if (stdout.length < MAX_OUTPUT_BYTES) {
                    stdout += chunk.toString();
                }
            });

            proc.stderr.on('data', (chunk) => {
                if (stderr.length < MAX_OUTPUT_BYTES) {
                    stderr += chunk.toString();
                }
            });

            // Timeout: SIGTERM first, then SIGKILL after 5s
            const timer = setTimeout(() => {
                killed = true;
                proc.kill('SIGTERM');
                setTimeout(() => {
                    try { proc.kill('SIGKILL'); } catch { /* already dead */ }
                }, 5000);
            }, timeout);

            proc.on('close', (code) => {
                clearTimeout(timer);
                exitCode = code;

                // Truncate if over limit
                if (stdout.length > MAX_OUTPUT_BYTES) {
                    stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + '\n[output truncated at 1MB]';
                }
                if (stderr.length > MAX_OUTPUT_BYTES) {
                    stderr = stderr.slice(0, MAX_OUTPUT_BYTES) + '\n[output truncated at 1MB]';
                }

                // Strip ANSI by default
                stdout = stripAnsi(stdout);
                stderr = stripAnsi(stderr);

                if (killed) {
                    resolve(`Error: Command timed out after ${timeout}ms\n${stdout}\n${stderr}`.trim());
                    return;
                }

                const output = (stdout + (stderr ? '\n' + stderr : '')).trim();
                if (code !== 0) {
                    resolve(`Exit code: ${code}\n${output}`.trim());
                } else {
                    resolve(output || '(no output)');
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timer);
                resolve(`Error: ${err.message}`);
            });

            // Close stdin
            proc.stdin.end();
        });
    },
};

// Background jobs store
const backgroundJobs = new Map();
let bgJobId = 0;

function runBackground(command) {
    const id = ++bgJobId;
    const proc = spawn(bashExecutable, ['-c', command], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const job = { id, pid: proc.pid, command, status: 'running', stdout: '', stderr: '' };
    backgroundJobs.set(id, job);

    proc.on('close', (code) => {
        job.status = code === 0 ? 'completed' : `exited(${code})`;
        job.stdout = stripAnsi(stdout.slice(0, MAX_OUTPUT_BYTES));
        job.stderr = stripAnsi(stderr.slice(0, MAX_OUTPUT_BYTES));
    });

    proc.unref();
    return `Background job started: id=${id}, pid=${proc.pid}`;
}

export { backgroundJobs };
