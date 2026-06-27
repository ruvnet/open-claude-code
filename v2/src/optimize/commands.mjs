/**
 * Top-level metaharness subcommands: `occ optimize`, `occ redblue`, `occ darwin`.
 *
 * These are dispatched from index.mjs BEFORE the normal agent flow, only when
 * the first CLI token matches. They never run during a normal `occ "prompt"`
 * invocation, so default behavior is untouched.
 *
 * - `occ optimize ...`  inspect/manage the self-optimization router + store.
 *   Pure local — no model calls, no network.
 * - `occ redblue ...`   delegate to the published `@metaharness/redblue` CLI via
 *   npx (self red/blue-team testing). Opt-in; only runs if the user asks.
 * - `occ darwin ...`    delegate to the published `@metaharness/darwin` CLI via
 *   npx (config evolution). Opt-in; only runs if the user asks.
 */
import { SelfOptimizeCascade } from './cascade.mjs';
import { OutcomeStore, outcomesPath } from './store.mjs';
import { createRouter } from './router.mjs';

/**
 * Handle `occ optimize <sub> [args]`. Returns a string to print and an exit code.
 * Never makes a model call.
 *
 * @param {string[]} argv tokens AFTER "optimize"
 * @param {object} [settings]
 * @returns {Promise<{ output: string, code: number }>}
 */
export async function runOptimize(argv, settings = {}) {
    const sub = (argv[0] || 'status').toLowerCase();
    const cascade = new SelfOptimizeCascade({ settings, store: new OutcomeStore() });

    switch (sub) {
        case 'status': {
            const s = cascade.status();
            const { nativeAvailable } = await createRouter();
            const lines = [
                'MetaHarness self-optimization — status',
                '',
                `  enabled by default: no (opt-in via --self-optimize / CLAUDE_CODE_SELF_OPTIMIZE=1 / "selfOptimize": true)`,
                `  router backend:     local cost-cascade`,
                `  native router pkg:  ${nativeAvailable ? '@metaharness/router available' : 'not installed (using local router)'}`,
                `  quality bar:        ${s.qualityBar}`,
                `  outcome store:      ${s.store}`,
                `  recorded outcomes:  ${s.summary.total}`,
                '',
                '  model ladder (cheapest first):',
                ...s.ladder.map((m, i) => `    ${i + 1}. ${m.id}  ($${m.costPerMTok}/1M tok)`),
            ];
            return { output: lines.join('\n'), code: 0 };
        }

        case 'route': {
            const task = argv.slice(1).join(' ');
            if (!task) return { output: 'Usage: occ optimize route "<task description>"', code: 2 };
            const r = cascade.decide(task);
            const lines = [
                `task complexity:    ${r.complexity.toFixed(3)}`,
                `routed to:          ${r.model}  ($${r.costPerMTok}/1M tok)`,
                `predicted quality:  ${r.predictedQuality.toFixed(3)}`,
                `cleared bar:        ${r.metBar}`,
                `ladder:             ${r.ladder.join(' -> ')}`,
                '',
                '(no model was called — this is a routing decision only)',
            ];
            return { output: lines.join('\n'), code: 0 };
        }

        case 'report': {
            const summary = cascade.store.summary();
            if (summary.total === 0) {
                return { output: 'No recorded outcomes yet. Run with --self-optimize to start collecting real cost/latency data.', code: 0 };
            }
            const lines = [`MetaHarness optimization report — ${summary.total} recorded outcomes`, ''];
            for (const [model, b] of Object.entries(summary.byModel)) {
                lines.push(`  ${model}`);
                lines.push(`    attempts: ${b.attempts}  success: ${(b.successRate * 100).toFixed(1)}%  avg latency: ${b.avgLatencyMs}ms  est cost: $${b.costUsd.toFixed(4)}`);
            }
            lines.push('');
            lines.push(`  total estimated cost: $${summary.totalCostUsd.toFixed(4)} (token counts × published prices — real, not fabricated)`);
            return { output: lines.join('\n'), code: 0 };
        }

        case 'reset': {
            const store = new OutcomeStore();
            const ok = store.reset();
            return { output: ok ? `Cleared outcome store: ${outcomesPath()}` : 'Nothing to reset (no store found).', code: 0 };
        }

        case 'help':
        default:
            return {
                output: [
                    'occ optimize — metaharness self-optimization (cost-cascade router)',
                    '',
                    'Subcommands:',
                    '  status                 Show router config, ladder, and recorded-outcome count',
                    '  route "<task>"         Show which model the cascade would pick (no model call)',
                    '  report                 Aggregate recorded outcomes (cost / success / latency)',
                    '  reset                  Delete the local outcome store',
                    '  help                   This message',
                    '',
                    'Enable the live router for normal runs with: occ --self-optimize -p "<task>"',
                ].join('\n'),
                code: sub === 'help' ? 0 : 0,
            };
    }
}

/**
 * Build the argv for delegating to a published metaharness CLI via npx.
 * Pure function so it is testable without spawning anything.
 *
 * @param {string} pkg npm package spec (e.g. "@metaharness/redblue")
 * @param {string[]} passthrough args after the subcommand
 * @returns {string[]} argv for child_process.spawn('npx', argv)
 */
export function buildNpxArgs(pkg, passthrough) {
    return ['-y', pkg, ...passthrough];
}

/**
 * Delegate to a published metaharness CLI via `npx`. Opt-in only; this spawns a
 * child process and streams its output. Returns the child's exit code.
 *
 * @param {string} pkg npm package spec
 * @param {string[]} passthrough args after the subcommand
 * @param {object} [deps] injectable spawn for testing
 * @returns {Promise<{ code: number }>}
 */
export async function delegateToCli(pkg, passthrough, deps = {}) {
    const spawn = deps.spawn || (await import('child_process')).spawn;
    return new Promise((resolve) => {
        const child = spawn('npx', buildNpxArgs(pkg, passthrough), { stdio: 'inherit' });
        child.on('error', (err) => {
            process.stderr.write(`Failed to run ${pkg} via npx: ${err.message}\n`);
            resolve({ code: 127 });
        });
        child.on('exit', (code) => resolve({ code: code ?? 0 }));
    });
}
