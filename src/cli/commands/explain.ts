import { InvalidArgumentError, Option, type Command } from '../command.ts';
import {
    explainPath,
    explainSkips,
    isOutside,
    MAX_EXPLAIN_LIMIT,
    outsideRootError,
} from '../../core/explain.ts';
import { renderPathExplanation, renderSkipsExplanation } from '../../reporters/explain.ts';
import { stringifyJson } from '../../format/text.ts';
import type { Context } from '../context.ts';
import { terminalWidth } from '../io.ts';
import { addScanOptions, explicitOptions, integer, read, resolveScanSettings } from '../options.ts';
import { ProgressLine } from '../progress.ts';

const EXAMPLES = `
Examples:
  $ dat explain                          what a scan of this directory leaves out, and why
  $ dat explain -g                       the same with .gitignore honored
  $ dat explain build/out.js -g          why one path is or is not counted
  $ dat explain node_modules/x -e '!node_modules'
                                         see why a negation has no effect
  $ dat explain src/a.ts --root ..       explain against a scan of another root
  $ dat explain -g --json | jq '.groups[0]'

A path argument is relative to the current directory. To analyze a directory
named "explain", run: dat ./explain
Exit codes: 0 for any explanation (excluded and not-found included), 1 for errors.
`;

function limitOption(value: string): number {
    const parsed = integer(0)(value);
    if (parsed > MAX_EXPLAIN_LIMIT) {
        throw new InvalidArgumentError(`Expected a whole number from 0 to ${MAX_EXPLAIN_LIMIT}.`);
    }
    return parsed;
}

export function registerExplain(program: Command, ctx: Context): void {
    const command = program
        .command('explain')
        .description('explain why a scan skips a path, or list everything it skips')
        .argument('[path]', 'a path to explain; omit it to summarize everything skipped');
    command.addOption(
        new Option(
            '--root <dir>',
            'the scan root to evaluate (default: the current directory)'
        ).helpGroup('Explain options:')
    );
    command.addOption(
        new Option(
            '--limit <n>',
            `entries listed per reason (default: 20, max: ${MAX_EXPLAIN_LIMIT})`
        )
            .argParser(limitOption)
            .helpGroup('Explain options:')
    );
    addScanOptions(command);
    command
        .addOption(new Option('-j, --json', 'print JSON').helpGroup('Output options:'))
        .addOption(
            new Option('--si', 'use decimal units (kB, MB) instead of binary (KiB, MiB)').helpGroup(
                'Output options:'
            )
        )
        .addOption(new Option('--color', 'force colors').helpGroup('Output options:'))
        .addOption(
            new Option('--no-color', 'disable colors (also honors NO_COLOR)').helpGroup(
                'Output options:'
            )
        )
        .addOption(
            new Option('--no-progress', 'hide the progress line').helpGroup('Output options:')
        )
        .addOption(
            new Option('-q, --quiet', 'print only the explanation and errors').helpGroup(
                'Output options:'
            )
        );
    command.addHelpText('after', EXAMPLES);
    command.action(async (path: string | undefined, _options: unknown, cmd: Command) => {
        const cli = explicitOptions(cmd);
        const root = ctx.resolvePath(read.string(cli['root']) ?? '.');
        const { config } = await ctx.loadConfig(cli, root);
        const settings = resolveScanSettings(cli, config);
        const json = cli['json'] === true;
        const units = cli['si'] === true ? 'si' : (config.units ?? 'iec');
        const style = ctx.outputStyle(read.boolean(cli['color']), false);
        const width = terminalWidth(ctx.io);

        if (path !== undefined) {
            const target = ctx.resolvePath(path);
            // Checked here too, so the error names the path as typed, not its absolute form.
            if (isOutside(root, target)) throw outsideRootError(path, root);
            const result = await explainPath(root, target, {
                ...settings,
                signal: ctx.io.signal,
            });
            await ctx.stdout(
                json
                    ? `${stringifyJson(result, 2)}\n`
                    : renderPathExplanation(result, { style, units })
            );
            return;
        }

        const progress = new ProgressLine(
            ctx.io.stderr,
            cli['progress'] !== false && cli['quiet'] !== true && ctx.io.stderr.isTTY === true,
            ctx.err,
            units
        );
        let result;
        try {
            if (progress.enabled) progress.update('Scanning for skipped entries');
            result = await explainSkips(root, {
                ...settings,
                limit: read.number(cli['limit']),
                signal: ctx.io.signal,
            });
        } finally {
            progress.clear();
        }
        await ctx.stdout(
            json
                ? `${stringifyJson(result, 2)}\n`
                : renderSkipsExplanation(result, { style, units, width })
        );
    });
}
