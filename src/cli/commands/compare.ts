import { Option, type Command } from '../command.ts';
import { compare } from '../../core/compare.ts';
import { renderComparisonAs } from '../../reporters/index.ts';
import type { Context } from '../context.ts';
import { terminalWidth } from '../io.ts';
import {
    addOutputOptions,
    addScanOptions,
    explicitOptions,
    integer,
    read,
    resolveDisplay,
    resolveScanSettings,
} from '../options.ts';
import { ProgressLine } from '../progress.ts';
import { formatCount } from '../../format/text.ts';
import { listLimit } from './analyze.ts';

const EXAMPLES = `
Examples:
  $ dat compare dist-before dist-after       what changed between two builds
  $ dat compare ./a ./b --content            also detect same-size content changes
  $ dat compare old new -f markdown          a table for a pull request comment
  $ dat compare old new --json | jq .delta
`;

export function registerCompare(program: Command, ctx: Context): void {
    const command = program
        .command('compare')
        .description('compare two directories: added, removed, and changed files, and size changes')
        .argument('<left>', 'the baseline directory')
        .argument('<right>', 'the directory to compare against the baseline');
    addScanOptions(command);
    command
        .addOption(
            new Option('--content', 'compare same-size files by content (SHA-256)').helpGroup(
                'Report options:'
            )
        )
        .addOption(
            new Option('-n, --top <n>', 'items per list (default: 10)')
                .argParser(integer(0))
                .helpGroup('Report options:')
        );
    addOutputOptions(command, ['pretty', 'json', 'markdown', 'csv']);
    command.addHelpText('after', EXAMPLES);
    command.action(async (left: string, right: string, _options: unknown, cmd: Command) => {
        const cli = explicitOptions(cmd);
        const { config } = await ctx.loadConfig(cli, ctx.io.cwd);
        const display = resolveDisplay(cli, config);
        const top = read.number(cli['top']) ?? config.top;
        const progress = new ProgressLine(
            ctx.io.stderr,
            display.progress && ctx.io.stderr.isTTY === true,
            ctx.err,
            display.units
        );
        let result;
        try {
            result = await compare(ctx.resolvePath(left), ctx.resolvePath(right), {
                ...resolveScanSettings(cli, config),
                content: cli['content'] === true,
                top: top ?? 10,
                signal: ctx.io.signal,
                ...(progress.enabled
                    ? {
                          onProgress: (p) =>
                              progress.update(
                                  p.phase === 'scan'
                                      ? `Scanning · ${formatCount(p.files)} files`
                                      : `Comparing contents · ${formatCount(p.files)} of ${formatCount(p.total ?? 0)}`
                              ),
                      }
                    : {}),
            });
        } finally {
            progress.clear();
        }

        const text = renderComparisonAs(display.format, result, {
            style: ctx.outputStyle(display.color, display.output !== undefined),
            units: display.units,
            width: terminalWidth(ctx.io),
            limit: listLimit(top),
            types: display.types,
            extensions: false,
        });
        if (display.output) {
            const file = await ctx.writeFile(display.output, text);
            ctx.info(`${ctx.err.green('✔')} Comparison written to ${file}`, display.quiet);
        } else {
            await ctx.stdout(text.endsWith('\n') ? text : `${text}\n`);
        }
    });
}
