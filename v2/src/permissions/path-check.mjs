/**
 * File Path Sanitization — validate file paths before allowing access.
 *
 * Prevents directory traversal, blocks sensitive files, and normalizes paths.
 */

import path from 'path';

/** File patterns that should never be read or written. */
const SENSITIVE_PATTERNS = [
    /\.env$/,
    /\.env\..+$/,
    /credentials\.json$/,
    /credentials\.yaml$/,
    /\.pem$/,
    /\.key$/,
    /id_rsa$/,
    /id_ed25519$/,
    /id_ecdsa$/,
    /id_dsa$/,
    /\.ssh\/config$/,
    /\.netrc$/,
    /\.pgpass$/,
    /\.aws\/credentials$/,
    /\.docker\/config\.json$/,
    /secrets\.yaml$/,
    /secrets\.json$/,
    /\.npmrc$/,
    /\.pypirc$/,
    /\.claude\/credentials$/,
    /service[_-]?account.*\.json$/i,
    /kubeconfig$/,
    /\.kube\/config$/,
];

/** Directories that should never be written to. */
const PROTECTED_DIRS = [
    '/etc',
    '/usr',
    '/sbin',
    '/boot',
    '/sys',
    '/proc',
];

/**
 * Validate a file path for safety.
 * @param {string} filePath - the path to validate
 * @param {object} [options]
 * @param {string} [options.cwd] - current working directory (default: process.cwd())
 * @param {boolean} [options.write] - whether this is a write operation
 * @returns {{ safe: boolean, resolved: string, reason?: string, warning?: string }}
 */
export function validatePath(filePath, options = {}) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        return { safe: false, resolved: '', reason: 'Empty or invalid path' };
    }

    const resolved = path.resolve(filePath);
    const cwd = options.cwd || process.cwd();

    // Check for null bytes (path injection)
    if (filePath.includes('\0')) {
        return { safe: false, resolved, reason: 'Null byte in path' };
    }

    // Check sensitive file patterns
    for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(resolved) || pattern.test(path.basename(resolved))) {
            return { safe: false, resolved, reason: 'Sensitive file' };
        }
    }

    // Check protected directories for writes
    if (options.write) {
        for (const dir of PROTECTED_DIRS) {
            if (resolved.startsWith(dir + '/') || resolved === dir) {
                return { safe: false, resolved, reason: `Protected directory: ${dir}` };
            }
        }
    }

    // Check for traversal outside cwd
    let warning;
    if (!resolved.startsWith(cwd) && !resolved.startsWith('/tmp')) {
        warning = 'Path is outside the current working directory';
    }

    return { safe: true, resolved, warning };
}

/**
 * Check if a filename matches sensitive patterns.
 * @param {string} filename
 * @returns {boolean}
 */
export function isSensitiveFile(filename) {
    for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(filename)) return true;
    }
    return false;
}

/**
 * Get list of sensitive patterns (for display/testing).
 * @returns {RegExp[]}
 */
export function getSensitivePatterns() {
    return [...SENSITIVE_PATTERNS];
}
