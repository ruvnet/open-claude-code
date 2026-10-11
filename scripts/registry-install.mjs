import { setTimeout as delay } from 'node:timers/promises';

// Registry metadata can become visible before npm's install metadata propagates.
// Retry only that installation failure, never package behavior or authentication.
export async function installWithPropagationRetry(attempt, {
    registry = false, budgetMs = 300000, intervalMs = 5000,
    now = Date.now, sleep = delay,
} = {}) {
    const deadline = now() + budgetMs;
    let index = 0;
    while (true) {
        const remaining = deadline - now();
        const result = await attempt(index++, Math.max(1, Math.min(90000, remaining)));
        if (result.code === 0 || !registry ||
            !/^npm (?:error|ERR!) code E(?:TARGET|404)\b/m.test(result.stderr || '')) return result;
        const wait = Math.min(intervalMs, deadline - now());
        if (wait <= 0) return result;
        await sleep(wait);
        if (now() >= deadline) return result;
    }
}
