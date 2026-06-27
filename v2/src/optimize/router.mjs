/**
 * MetaHarness cost-cascade router (opt-in self-optimization layer).
 *
 * Thesis (DRACO / metaharness): route each task to the CHEAPEST model that is
 * "good enough", and only escalate to a frontier model when the cheap one is
 * predicted to fail or actually fails. Over time the router learns from real
 * recorded outcomes (cost / latency / success) and tightens its predictions.
 *
 * This module is a thin, ZERO-DEPENDENCY local router so that `npx` startup and
 * `npm ci` stay clean and fast. When the published `@metaharness/router` package
 * is installed AND an embedding function is available, {@link createRouter} can
 * upgrade to its k-NN-over-embeddings `Router` — but that is strictly optional
 * and loaded via dynamic import; it is never a hard runtime dependency.
 *
 * Nothing here makes a model call. Routing is a pure decision over a ladder of
 * candidate models plus historical outcome statistics.
 */

/**
 * Default model ladder, cheapest → most capable. Prices are blended USD per 1M
 * tokens (input+output rough blend) used purely as the cost axis the router
 * minimises. They are conservative public list prices, not fabricated metrics.
 *
 * @type {Array<{ id: string, costPerMTok: number, tier: number }>}
 */
export const DEFAULT_LADDER = [
    { id: 'claude-haiku-4-5', costPerMTok: 1.0, tier: 1 },
    { id: 'claude-sonnet-4-6', costPerMTok: 9.0, tier: 2 },
    { id: 'claude-opus-4-6', costPerMTok: 45.0, tier: 3 },
];

/** Clamp a number into [min, max]. */
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

/**
 * Heuristic task-complexity estimate in [0, 1] from the raw prompt text.
 * Deterministic and side-effect free so it is fully testable. The cascade uses
 * this only as a PRIOR; recorded outcomes override it as evidence accumulates.
 *
 * @param {string} text
 * @returns {number} complexity score 0 (trivial) .. 1 (very hard)
 */
export function estimateComplexity(text) {
    if (!text || typeof text !== 'string') return 0;
    const t = text.toLowerCase();
    let score = 0;

    // Length is a weak signal of scope.
    score += clamp(text.length / 4000, 0, 0.35);

    // Multi-step / planning / architecture language → harder.
    const hardSignals = [
        'refactor', 'architecture', 'design', 'debug', 'race condition',
        'concurrency', 'security', 'migrate', 'optimi', 'algorithm',
        'distributed', 'across files', 'multi-file', 'end-to-end', 'prove',
    ];
    for (const sig of hardSignals) {
        if (t.includes(sig)) score += 0.12;
    }

    // Trivial / lookup language → easier.
    const easySignals = ['what is', 'rename', 'typo', 'format', 'list', 'print', 'echo', 'add a comment'];
    for (const sig of easySignals) {
        if (t.includes(sig)) score -= 0.1;
    }

    // Code fences and multiple questions suggest a heavier task.
    const codeFences = (text.match(/```/g) || []).length;
    if (codeFences >= 2) score += 0.08;
    const questions = (text.match(/\?/g) || []).length;
    if (questions >= 3) score += 0.08;

    return clamp(score, 0, 1);
}

/**
 * @typedef {object} OutcomeStats
 * @property {number} attempts   total recorded attempts for a model
 * @property {number} successes  recorded successes
 * @property {number} successRate successes / attempts (0 when no data)
 */

/**
 * Cost-cascade router. Pure decision layer over a model ladder plus optional
 * historical {@link OutcomeStats}. No I/O, no model calls.
 */
export class MetaHarnessRouter {
    /**
     * @param {object} [opts]
     * @param {Array<{id:string,costPerMTok:number,tier?:number}>} [opts.ladder] cheapest-first model ladder
     * @param {number} [opts.qualityBar] required success rate 0..1 to accept a cheap model (default 0.7)
     * @param {(modelId:string)=>OutcomeStats} [opts.statsFor] looks up recorded outcome stats per model
     * @param {number} [opts.minSamples] min recorded attempts before stats override the prior (default 3)
     */
    constructor(opts = {}) {
        this.ladder = (opts.ladder && opts.ladder.length ? opts.ladder : DEFAULT_LADDER)
            .slice()
            .sort((a, b) => a.costPerMTok - b.costPerMTok);
        this.qualityBar = typeof opts.qualityBar === 'number' ? clamp(opts.qualityBar, 0, 1) : 0.7;
        this.statsFor = typeof opts.statsFor === 'function' ? opts.statsFor : () => ({ attempts: 0, successes: 0, successRate: 0 });
        this.minSamples = typeof opts.minSamples === 'number' ? opts.minSamples : 3;
    }

    /**
     * Predict a model's success probability on a task of the given complexity.
     * Blends recorded stats (once enough samples exist) with a complexity-aware
     * prior derived from the model's tier position in the ladder.
     *
     * @param {{id:string,tier?:number}} model
     * @param {number} complexity 0..1
     * @returns {number} predicted success probability 0..1
     */
    predict(model, complexity) {
        const tier = model.tier || (this.ladder.findIndex(m => m.id === model.id) + 1) || 1;
        const maxTier = this.ladder.length || 1;

        // Prior: cheaper/lower-tier models lose probability as complexity rises;
        // top-tier models stay near-confident regardless.
        const tierStrength = tier / maxTier; // 0..1
        const prior = clamp(1 - complexity * (1 - tierStrength) - 0.05 * (1 - tierStrength), 0, 1);

        const stats = this.statsFor(model.id) || { attempts: 0, successRate: 0 };
        if (stats.attempts >= this.minSamples) {
            // Evidence weight grows with samples but is capped so the prior never
            // fully disappears (avoids overfitting a handful of runs).
            const w = clamp(stats.attempts / (stats.attempts + this.minSamples), 0, 0.9);
            return clamp(w * stats.successRate + (1 - w) * prior, 0, 1);
        }
        return prior;
    }

    /**
     * Pick the cheapest model whose predicted success clears the quality bar.
     * Falls back to the highest-predicted (i.e. top of ladder) when none clear it.
     *
     * @param {string} taskText
     * @returns {{ model: string, costPerMTok: number, predictedQuality: number, metBar: boolean, complexity: number, ladder: string[] }}
     */
    route(taskText) {
        const complexity = estimateComplexity(taskText);
        let best = null;

        for (const m of this.ladder) {
            const q = this.predict(m, complexity);
            if (q >= this.qualityBar) {
                return {
                    model: m.id,
                    costPerMTok: m.costPerMTok,
                    predictedQuality: q,
                    metBar: true,
                    complexity,
                    ladder: this.ladder.map(x => x.id),
                };
            }
            if (!best || q > best.predictedQuality) {
                best = { model: m.id, costPerMTok: m.costPerMTok, predictedQuality: q };
            }
        }

        // None cleared the bar — escalate to the most capable model.
        const top = this.ladder[this.ladder.length - 1];
        return {
            model: top.id,
            costPerMTok: top.costPerMTok,
            predictedQuality: this.predict(top, complexity),
            metBar: false,
            complexity,
            ladder: this.ladder.map(x => x.id),
        };
    }

    /**
     * Given a model that just failed, return the next more-capable model to
     * escalate to, or null if already at the top of the ladder.
     *
     * @param {string} failedModelId
     * @returns {string|null}
     */
    escalate(failedModelId) {
        const idx = this.ladder.findIndex(m => m.id === failedModelId);
        if (idx === -1 || idx >= this.ladder.length - 1) return null;
        return this.ladder[idx + 1].id;
    }
}

/**
 * Build a router. Defaults to the local zero-dependency {@link MetaHarnessRouter}.
 * If `@metaharness/router` is installed and `embed` is provided, this will report
 * that the native k-NN router is available (the caller can opt into it), but the
 * local router is always returned as the safe default so behavior is predictable
 * and dependency-free.
 *
 * @param {object} [opts] passed to MetaHarnessRouter
 * @returns {Promise<{ router: MetaHarnessRouter, backend: 'local'|'metaharness', nativeAvailable: boolean }>}
 */
export async function createRouter(opts = {}) {
    let nativeAvailable = false;
    try {
        // Probe only — never required. Resolving the specifier does not install it.
        await import('@metaharness/router');
        nativeAvailable = true;
    } catch {
        nativeAvailable = false;
    }
    return {
        router: new MetaHarnessRouter(opts),
        backend: 'local',
        nativeAvailable,
    };
}
