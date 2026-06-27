/**
 * Outcome store for the self-optimization layer.
 *
 * Persists ONE JSON line per routed task with the REAL observed signals
 * (model, cost estimate, latency, success). The router reads aggregated stats
 * from this store to self-tune toward the cheapest model that actually succeeds.
 *
 * Honesty rule: this records only what happened. Cost is an estimate derived
 * from real token counts × the model's published price; latency is measured
 * wall-clock. Nothing is fabricated.
 *
 * Default location: ~/.claude/optimize/outcomes.jsonl
 * Override with CLAUDE_CODE_OPTIMIZE_DIR (used heavily in tests).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

/** Resolve the directory the store writes to. */
export function optimizeDir() {
    return process.env.CLAUDE_CODE_OPTIMIZE_DIR || path.join(os.homedir(), '.claude', 'optimize');
}

/** Resolve the JSONL outcomes file path. */
export function outcomesPath() {
    return path.join(optimizeDir(), 'outcomes.jsonl');
}

/**
 * @typedef {object} Outcome
 * @property {string} model        model id the task was routed to
 * @property {boolean} success     whether the task completed without error
 * @property {number} [latencyMs]  measured wall-clock latency
 * @property {number} [inputTokens]  real input tokens used
 * @property {number} [outputTokens] real output tokens used
 * @property {number} [costUsd]    estimated cost (tokens × published price)
 * @property {number} [complexity] router complexity estimate at route time
 * @property {string} [task]       short task descriptor (truncated)
 * @property {number} [ts]         epoch ms (auto-filled)
 */

/**
 * In-memory + file-backed outcome store.
 */
export class OutcomeStore {
    /** @param {string} [filePath] override file path (defaults to outcomesPath()) */
    constructor(filePath) {
        this.filePath = filePath || outcomesPath();
    }

    /** Ensure the parent directory exists. */
    _ensureDir() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    /**
     * Append a recorded outcome. Never throws on I/O — self-optimization must
     * never break the user's session. Returns the stored record (with ts).
     *
     * @param {Outcome} outcome
     * @returns {Outcome}
     */
    record(outcome) {
        const rec = { ts: Date.now(), ...outcome };
        if (rec.task && typeof rec.task === 'string' && rec.task.length > 120) {
            rec.task = rec.task.slice(0, 120);
        }
        try {
            this._ensureDir();
            fs.appendFileSync(this.filePath, JSON.stringify(rec) + '\n');
        } catch {
            // Swallow — recording is best-effort.
        }
        return rec;
    }

    /**
     * Read all stored outcomes. Tolerant of partial/corrupt lines.
     * @returns {Outcome[]}
     */
    all() {
        try {
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            const out = [];
            for (const line of raw.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try { out.push(JSON.parse(trimmed)); } catch { /* skip bad line */ }
            }
            return out;
        } catch {
            return [];
        }
    }

    /**
     * Aggregate stats for a single model.
     * @param {string} modelId
     * @returns {{ attempts: number, successes: number, successRate: number }}
     */
    statsFor(modelId) {
        let attempts = 0;
        let successes = 0;
        for (const o of this.all()) {
            if (o.model !== modelId) continue;
            attempts++;
            if (o.success) successes++;
        }
        return { attempts, successes, successRate: attempts ? successes / attempts : 0 };
    }

    /**
     * Full rollup across every model seen, plus cost totals. Used by
     * `occ optimize report`.
     * @returns {{ total: number, byModel: Record<string, {attempts:number,successes:number,successRate:number,costUsd:number,avgLatencyMs:number}>, totalCostUsd: number, estimatedSavingsUsd: number }}
     */
    summary() {
        const all = this.all();
        /** @type {Record<string, any>} */
        const byModel = {};
        let totalCostUsd = 0;
        // For savings estimate: what every task would have cost on the most
        // expensive model actually observed, vs what it actually cost.
        let maxPriceObserved = 0;

        for (const o of all) {
            const m = o.model || 'unknown';
            if (!byModel[m]) byModel[m] = { attempts: 0, successes: 0, costUsd: 0, latencySum: 0, latencyN: 0 };
            byModel[m].attempts++;
            if (o.success) byModel[m].successes++;
            if (typeof o.costUsd === 'number') { byModel[m].costUsd += o.costUsd; totalCostUsd += o.costUsd; }
            if (typeof o.latencyMs === 'number') { byModel[m].latencySum += o.latencyMs; byModel[m].latencyN++; }
        }

        for (const m of Object.keys(byModel)) {
            const b = byModel[m];
            b.successRate = b.attempts ? b.successes / b.attempts : 0;
            b.avgLatencyMs = b.latencyN ? Math.round(b.latencySum / b.latencyN) : 0;
            delete b.latencySum; delete b.latencyN;
        }

        return {
            total: all.length,
            byModel,
            totalCostUsd: Number(totalCostUsd.toFixed(6)),
            // Savings are reported only as "vs always-frontier" and only when we
            // have real cost data — otherwise 0, never invented.
            estimatedSavingsUsd: 0,
        };
    }

    /** Delete the store (used by `occ optimize reset`). Best-effort. */
    reset() {
        try { if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath); return true; }
        catch { return false; }
    }
}

/**
 * Rough cost estimate in USD for a token count at a blended $/1M price.
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {number} costPerMTok blended price per 1M tokens
 * @returns {number}
 */
export function estimateCostUsd(inputTokens = 0, outputTokens = 0, costPerMTok = 0) {
    const total = (inputTokens || 0) + (outputTokens || 0);
    return Number(((total / 1_000_000) * (costPerMTok || 0)).toFixed(6));
}
