/**
 * SSRF Protection — block requests to private/internal/loopback hosts.
 *
 * Prevents the WebFetch tool from being used as a Server-Side Request
 * Forgery vector to probe internal network services, cloud metadata
 * endpoints, or localhost.
 *
 * Covers:
 * - Loopback: 127.0.0.0/8, ::1
 * - Link-local: 169.254.0.0/16 (includes AWS/GCP/Azure metadata: 169.254.169.254)
 * - Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - IPv6 private: fc00::/7 (ULA), fe80::/10 (link-local)
 * - Unroutable: 0.0.0.0/8, 100.64.0.0/10 (CGNAT), 192.0.0.0/24
 * - "localhost" and other reserved hostnames
 */

/** Hostnames that are unconditionally blocked. */
const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'ip6-localhost',
    'ip6-loopback',
    'broadcasthost',
    'metadata.google.internal',       // GCP metadata
    'metadata.gcp.internal',
]);

/**
 * Check whether a hostname resolves to a private or internal address.
 * This operates purely on the literal hostname/IP string; it does NOT
 * perform DNS resolution (to avoid TOCTOU races).
 *
 * @param {string} hostname - the hostname portion from a parsed URL
 * @returns {boolean} true if the host should be blocked
 */
export function isPrivateHost(hostname) {
    if (!hostname || typeof hostname !== 'string') return true;

    const h = hostname.toLowerCase().trim();

    // Block by hostname
    if (BLOCKED_HOSTNAMES.has(h)) return true;

    // Block *.local mDNS hostnames
    if (h.endsWith('.local')) return true;

    // Strip IPv6 brackets if present
    const raw = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;

    // IPv4 check
    if (isIPv4(raw)) return isPrivateIPv4(raw);

    // IPv6 check
    if (isIPv6Like(raw)) return isPrivateIPv6(raw);

    // Numeric decimal/hex/octal IP encodings (bypass attempts)
    if (/^[0-9]+$/.test(raw) || /^0x[0-9a-f]+$/i.test(raw)) return true;

    return false;
}

function isIPv4(s) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

function isIPv6Like(s) {
    return s.includes(':');
}

function isPrivateIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;
    const [a, b, c] = parts;

    if (a === 0) return true;                               // 0.0.0.0/8
    if (a === 10) return true;                              // 10.0.0.0/8
    if (a === 127) return true;                             // 127.0.0.0/8 loopback
    if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64.0.0/10 CGNAT
    if (a === 169 && b === 254) return true;                // 169.254.0.0/16 link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12 private
    if (a === 192 && b === 0 && c === 0) return true;      // 192.0.0.0/24
    if (a === 192 && b === 168) return true;                // 192.168.0.0/16 private
    if (a === 198 && (b === 18 || b === 19)) return true;  // 198.18.0.0/15 benchmarking
    if (a === 198 && b === 51 && c === 100) return true;   // 198.51.100.0/24 documentation
    if (a === 203 && b === 0 && c === 113) return true;    // 203.0.113.0/24 documentation
    if (a >= 224) return true;                             // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved

    return false;
}

function isPrivateIPv6(ip) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;                  // loopback
    if (lower === '::') return true;                   // unspecified
    if (lower.startsWith('::ffff:')) {                 // IPv4-mapped
        const v4 = lower.slice(7);
        if (isIPv4(v4)) return isPrivateIPv4(v4);
    }
    if (lower.startsWith('fe80:')) return true;        // fe80::/10 link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
    if (lower.startsWith('ff')) return true;           // multicast
    return false;
}
