/**
 * Self-optimization cascade controller.
 *
 * Glue between {@link MetaHarnessRouter} and {@link OutcomeStore}. Given a task,
 * it decides which model to use (cost-cascade), and after the task completes it
 * records the real outcome so future routing self-tunes.
 *
 * This is OPT-IN. It is only constructed when the user enables self-optimization
 * via `--self-optimize`, the `selfOptimize` setting, or CLAUDE_CODE_SELF_OPTIMIZE.
 * When disabled, the agent loop never imports or runs any of this, so default
 * behavior is byte-identical.
 */
import { MetaHarnessRouter, DEFAULT_LADDER } from './router.mjs';
import { OutcomeStore, estimateCostUsd } from './store.mjs';

/**
 * Build a model ladder from settings, falling back to the default. Honors an
 * explicit `selfOptimizeLadder` setting (array of {id,costPerMTok}) and keeps
 * the configured base/fast/frontier models if present.
 *
 * @param {object} [settings]
 * @returns {Array<{id:string,costPerMTok:number,tier?:number}>}
 */
export function buildLadder(settings = {}) {
    if (Array.isArray(settings.selfOptimizeLadder) && settings.selfOptimizeLadder.length) {
        return settings.selfOptimizeLadder
            .filter(m => m && m.id && typeof m.costPerMTok === 'number')
            .map((m, i) => ({ tier: i + 1, ...m }));
    }
    return DEFAULT_LADDER;
}

/**
 * Cascade controller. Holds a router + outcome store and exposes a small API the
 * agent loop calls.
 */
export class SelfOptimizeCascade {
    /**
     * @param {object} [opts]
     * @param {object} [opts.settings] CLI settings (ladder, qualityBar)
     * @param {OutcomeStore} [opts.store] outcome store (defaults to a fresh one)
     * @param {string} [opts.fallbackModel] model to use if routing yields nothing
     */
    constructor(opts = {}) {
        const settings = opts.settings || {};
        this.store = opts.store || new OutcomeStore();
        this.fallbackModel = opts.fallbackModel || settings.model || 'claude-sonnet-4-6';
        const ladder = buildLadder(settings);
        this.ladder = ladder;
        this.router = new MetaHarnessRouter({
            ladder,
            qualityBar: typeof settings.selfOptimizeQualityBar === 'number' ? settings.selfOptimizeQualityBar : 0.7,
            statsFor: (id) => this.store.statsFor(id),
        });
        /** @type {Array<{task:string, route:object}>} last routing decisions (in-memory, for inspection) */
        this.lastRoutes = [];
    }

    /**
     * Decide which model to use for a task without making any model call.
     * @param {string} taskText
     * @returns {{ model: string, predictedQuality: number, costPerMTok: number, metBar: boolean, complexity: number, ladder: string[] }}
     */
    decide(taskText) {
        const route = this.router.route(taskText || '');
        this.lastRoutes.push({ task: (taskText || '').slice(0, 80), route });
        if (this.lastRoutes.length > 50) this.lastRoutes.shift();
        return route;
    }

    /**
     * Record a completed task's real outcome.
     * @param {object} o
     * @param {string} o.model
     * @param {boolean} o.success
     * @param {number} [o.latencyMs]
     * @param {number} [o.inputTokens]
     * @param {number} [o.outputTokens]
     * @param {number} [o.complexity]
     * @param {string} [o.task]
     */
    recordOutcome(o) {
        const entry = this.ladder.find(m => m.id === o.model);
        const costUsd = estimateCostUsd(o.inputTokens, o.outputTokens, entry ? entry.costPerMTok : 0);
        return this.store.record({
            model: o.model,
            success: !!o.success,
            latencyMs: o.latencyMs,
            inputTokens: o.inputTokens,
            outputTokens: o.outputTokens,
            costUsd,
            complexity: o.complexity,
            task: o.task,
        });
    }

    /** Get the next model to escalate to after a failure, or null. */
    escalate(failedModelId) {
        return this.router.escalate(failedModelId);
    }

    /** Human-readable status for `occ optimize status`. */
    status() {
        return {
            ladder: this.ladder.map(m => ({ id: m.id, costPerMTok: m.costPerMTok })),
            qualityBar: this.router.qualityBar,
            store: this.store.filePath,
            summary: this.store.summary(),
        };
    }
}

/**
 * Decide whether self-optimization is enabled, from the precedence:
 * CLI flag > env var > setting. Default OFF.
 *
 * @param {object} [args] parsed CLI args (may have selfOptimize)
 * @param {object} [settings]
 * @param {object} [env] process.env-like
 * @returns {boolean}
 */
export function isSelfOptimizeEnabled(args = {}, settings = {}, env = process.env) {
    if (args.selfOptimize === true) return true;
    if (args.selfOptimize === false) return false; // explicit --no-self-optimize would set this
    if (env && env.CLAUDE_CODE_SELF_OPTIMIZE === '1') return true;
    if (env && env.CLAUDE_CODE_SELF_OPTIMIZE === '0') return false;
    return settings.selfOptimize === true;
}
