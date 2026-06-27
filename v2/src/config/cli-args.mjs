/**
 * CLI Argument Parser — supports all major Claude Code flags.
 *
 * Flags:
 * --model, -m          Model to use
 * --permission-mode    Permission mode
 * --print, -p          Print mode (non-interactive prompt)
 * --output-format      json, text, stream-json
 * --system-prompt      Override system prompt
 * --add-dir            Additional CLAUDE.md directories
 * --max-turns          Maximum conversation turns
 * --allowedTools       Comma-separated allowed tools
 * --disallowedTools    Comma-separated denied tools
 * --verbose, -v        Verbose output
 * --debug, -d          Debug mode
 * --version            Show version
 * --help, -h           Show help
 */

export function parseArgs(args) {
    const result = {
        prompt: null,
        model: null,
        permissionMode: null,
        outputFormat: null,
        systemPrompt: null,
        addDirs: [],
        maxTurns: null,
        allowedTools: null,
        disallowedTools: null,
        verbose: false,
        debug: false,
        showVersion: false,
        showHelp: false,
        // Opt-in metaharness self-optimization. null = unset (defer to env/setting).
        selfOptimize: null,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '--model':
            case '-m':
                result.model = args[++i];
                break;

            case '--permission-mode':
                result.permissionMode = args[++i];
                break;

            case '--print':
            case '-p':
                result.prompt = args[++i];
                break;

            case '--output-format':
                result.outputFormat = args[++i];
                break;

            case '--system-prompt':
                result.systemPrompt = args[++i];
                break;

            case '--add-dir':
                result.addDirs.push(args[++i]);
                break;

            case '--max-turns':
                result.maxTurns = parseInt(args[++i], 10);
                break;

            case '--allowedTools':
                result.allowedTools = args[++i]?.split(',').map(s => s.trim());
                break;

            case '--disallowedTools':
                result.disallowedTools = args[++i]?.split(',').map(s => s.trim());
                break;

            case '--verbose':
            case '-v':
                result.verbose = true;
                break;

            case '--debug':
            case '-d':
                result.debug = true;
                break;

            case '--self-optimize':
                result.selfOptimize = true;
                break;

            case '--no-self-optimize':
                result.selfOptimize = false;
                break;

            case '--version':
                result.showVersion = true;
                break;

            case '--help':
            case '-h':
                result.showHelp = true;
                break;

            default:
                // Bare argument becomes prompt
                if (!arg.startsWith('-')) {
                    result.prompt = arg;
                }
                break;
        }
    }

    return result;
}

/**
 * Print usage/help text.
 * @returns {string}
 */
export function getUsageText() {
    return `
Usage: occ [options] [prompt]

Options:
  --model, -m <model>        Model to use (default: claude-sonnet-4-6)
  --permission-mode <mode>   Permission mode (bypassPermissions, acceptEdits, plan, auto, dontAsk)
  --print, -p <prompt>       Non-interactive mode: run prompt and exit
  --output-format <fmt>      Output format: text, json, stream-json
  --system-prompt <text>     Override system prompt
  --add-dir <dir>            Additional directory to search for CLAUDE.md
  --max-turns <n>            Maximum conversation turns
  --allowedTools <tools>     Comma-separated list of allowed tools
  --disallowedTools <tools>  Comma-separated list of denied tools
  --verbose, -v              Verbose output
  --debug, -d                Debug mode
  --self-optimize            Route model calls through the metaharness cost-cascade
                             (cheap base -> escalate) and record real outcomes (opt-in)
  --no-self-optimize         Force self-optimization off (overrides env/setting)
  --version                  Show version
  --help, -h                 Show this help

Subcommands:
  occ optimize <status|route|report|reset|help>   Inspect/manage the self-optimization router (no model calls)
  occ redblue [...]          Delegate to @metaharness/redblue CLI (self red/blue-team testing, via npx)
  occ darwin  [...]          Delegate to @metaharness/darwin CLI (config evolution, via npx)

Examples:
  occ                        Start interactive REPL
  occ -p "What is 2+2?"     Run prompt and exit
  occ -m claude-haiku-4-5    Use Haiku model
  occ --debug -p "Fix bug"  Debug mode with prompt
  occ --self-optimize -p "..."   Run with the cost-cascade router enabled
  occ optimize status        Show the router config and recorded outcomes
`.trim();
}
