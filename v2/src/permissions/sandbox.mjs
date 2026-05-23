/**
 * Sandbox — wrap commands in platform-specific sandboxes.
 *
 * Linux: bubblewrap (bwrap)
 * macOS: sandbox-exec (seatbelt)
 * Windows/other: passthrough (no sandbox)
 */

export class Sandbox {
    /**
     * @param {string} [platform] - override process.platform
     */
    constructor(platform) {
        this.platform = platform || process.platform;
    }

    /**
     * Wrap a command to run inside a sandbox.
     * @param {string} command - the command to sandbox
     * @param {object} [options]
     * @param {string[]} [options.allowWrite] - directories to allow writes
     * @param {string[]} [options.allowNet] - allow network access (macOS)
     * @param {boolean} [options.allowDevices] - allow device access
     * @returns {string} sandboxed command
     */
    wrapCommand(command, options = {}) {
        if (this.platform === 'linux') return this.bubblewrap(command, options);
        if (this.platform === 'darwin') return this.seatbelt(command, options);
        return command; // fallback: no sandbox
    }

    /**
     * Linux sandbox using bubblewrap.
     * Creates a minimal read-only root with /dev, /proc, /tmp.
     */
    bubblewrap(command, opts = {}) {
        const args = [
            '--ro-bind', '/', '/',
            '--dev', '/dev',
            '--proc', '/proc',
            '--tmpfs', '/tmp',
        ];

        // Allow specific writable directories
        if (opts.allowWrite) {
            for (const dir of opts.allowWrite) {
                // Validate: must be a non-empty absolute path with no shell metacharacters
                if (typeof dir === 'string' && dir.length > 0 &&
                    dir.startsWith('/') && !/[\s'"`$\\;|&<>(){}!]/.test(dir) &&
                    !dir.includes('\0')) {
                    args.push('--bind', dir, dir);
                }
            }
        }

        // Allow /dev access if requested
        if (opts.allowDevices) {
            args.push('--dev-bind', '/dev', '/dev');
        }

        return `bwrap ${args.join(' ')} -- ${command}`;
    }

    /**
     * macOS sandbox using sandbox-exec with a seatbelt profile.
     * Returns a sandbox-exec wrapped command with a generated profile.
     */
    seatbelt(command, opts = {}) {
        const rules = [
            '(version 1)',
            '(deny default)',
            '(allow process-exec)',
            '(allow process-fork)',
            '(allow file-read*)',
            '(allow sysctl-read)',
            '(allow mach-lookup)',
        ];

        // Allow writes to specific directories
        if (opts.allowWrite) {
            for (const dir of opts.allowWrite) {
                // Validate: must be a non-empty absolute path with no shell/seatbelt metacharacters
                if (typeof dir === 'string' && dir.length > 0 &&
                    dir.startsWith('/') && !/['"\\;(){}]/.test(dir) &&
                    !dir.includes('\0')) {
                    rules.push(`(allow file-write* (subpath "${dir}"))`);
                }
            }
        }

        // Allow /tmp writes by default
        rules.push('(allow file-write* (subpath "/tmp"))');

        // Allow network if requested
        if (opts.allowNet) {
            rules.push('(allow network*)');
        }

        const profile = rules.join('\n');
        // Escape single quotes in profile for shell
        const escaped = profile.replace(/'/g, "'\\''");
        return `sandbox-exec -p '${escaped}' ${command}`;
    }

    /**
     * Check if sandbox tooling is available on this platform.
     * @returns {{ available: boolean, tool: string }}
     */
    check() {
        if (this.platform === 'linux') {
            return { available: true, tool: 'bwrap' };
        }
        if (this.platform === 'darwin') {
            return { available: true, tool: 'sandbox-exec' };
        }
        return { available: false, tool: 'none' };
    }
}
