/**
 * Command Injection Check — detect dangerous shell patterns.
 *
 * Scans commands for common injection vectors before allowing
 * Bash tool execution.
 */

const DANGEROUS_PATTERNS = [
    { pattern: /;\s*rm\s+-rf\s+\//, label: 'rm -rf /' },
    { pattern: /\|\s*sh\b/, label: 'pipe to sh' },
    { pattern: /\|\s*bash\b/, label: 'pipe to bash' },
    { pattern: /`[^`]+`/, label: 'backtick execution' },
    { pattern: /\$\(/, label: 'command substitution' },
    { pattern: />\s*\/etc\//, label: 'write to /etc' },
    { pattern: />\s*\/usr\//, label: 'write to /usr' },
    { pattern: /curl\s.*\|\s*(bash|sh)/, label: 'curl pipe to shell' },
    { pattern: /wget\s.*\|\s*(bash|sh)/, label: 'wget pipe to shell' },
    { pattern: /mkfs\./, label: 'filesystem format' },
    { pattern: /dd\s+if=.*of=\/dev\//, label: 'dd to device' },
    { pattern: /:\(\)\s*\{.*\|.*&\s*\}/, label: 'fork bomb' },
    { pattern: /chmod\s+777\s+\//, label: 'chmod 777 root' },
    { pattern: />\s*\/dev\/sd[a-z]/, label: 'write to disk device' },
    { pattern: /eval\s+"?\$/, label: 'eval variable' },
    { pattern: /\bexec\s+\d+[<>]/, label: 'exec fd redirect' },
];

/**
 * Check a command string for injection patterns.
 * @param {string} command - shell command to check
 * @returns {{ safe: boolean, pattern?: string, label?: string }}
 */
export function checkInjection(command) {
    if (typeof command !== 'string') {
        return { safe: false, label: 'non-string command' };
    }

    for (const { pattern, label } of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
            return { safe: false, pattern: pattern.source, label };
        }
    }

    return { safe: true };
}

/**
 * Get the list of dangerous patterns (for display/testing).
 * @returns {Array<{ pattern: RegExp, label: string }>}
 */
export function getDangerousPatterns() {
    return DANGEROUS_PATTERNS.map(({ pattern, label }) => ({ pattern, label }));
}

/**
 * Check if a command uses any elevated privilege patterns.
 * @param {string} command
 * @returns {boolean}
 */
export function usesElevation(command) {
    return /\bsudo\b/.test(command) || /\bsu\s+-?\s/.test(command) || /\bdoas\b/.test(command);
}
