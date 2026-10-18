import { Option, type Command } from 'commander';
import { Excluder } from '../../core/exclude.ts';
import { listDirectories } from '../../core/options.ts';
import { AbortError, errorMessage } from '../../errors.ts';
import { formatBytes } from '../../format/bytes.ts';
import { formatCount } from '../../format/text.ts';
import type { AnalysisResult } from '../../types.ts';
import type { Context } from '../context.ts';
import {
    addOutputOptions,
    addReportOptions,
    addScanOptions,
    applyLegacyLargeFiles,
    explicitOptions,
    integer,
    read,
    resolveAnalyzeOptions,
    resolveDisplay,
} from '../options.ts';
import { TreeWatcher } from '../watcher.ts';
import { emit, listLimit, runAnalysis } from './analyze.ts';

const CLEAR_SCREEN = '\u001B[2J\u001B[3J\u001B[H';

const EXAMPLES = `
Examples:
  $ dat watch                          re-analyze the current directory on every change
  $ dat watch ./downloads -l 1GB       keep an eye on large downloads
  $ dat watch . --json | jq -c .summary
                                       one JSON document per line (NDJSON)
`;

export function registerWatch(program: Command, ctx: Context): void {
    const command = program
        .command('watch')
        .description('re-analyze a directory whenever it changes')
        .argument('[directory]', 'directory to watch', '.');
    addScanOptions(command);
    addReportOptions(command);
    addOutputOptions(command, ['pretty', 'json']);
    command
        .addOption(
            new Option('--debounce <ms>', 'wait this long after the last change (default: 300)')
                .argParser(integer(0))
                .helpGroup('Watch options:')
        )
        .addOption(
            new Option(
                '--poll <seconds>',
                're-scan on an interval instead of using filesystem events'
            )
                .argParser(integer(1))
                .helpGroup('Watch options:')
        )
        .addOption(
            new Option(
                '--no-clear',
                'keep previous reports instead of clearing the screen'
            ).helpGroup('Watch options:')
        );
    command.addHelpText('after', EXAMPLES);

    command.action(async (directory: string, _options: unknown, cmd: Command) => {
        const cli = explicitOptions(cmd);
        applyLegacyLargeFiles(cli, (message) => ctx.warn(message));
        const target = ctx.resolvePath(directory);
        const { config } = await ctx.loadConfig(cli, target);
        const display = resolveDisplay(cli, config);
        const options = resolveAnalyzeOptions(cli, config);
        const debounce = read.number(cli['debounce']) ?? 300;
        const pollSeconds = read.number(cli['poll']);
        const clear =
            cli['clear'] !== false && display.format === 'pretty' && ctx.io.stdout.isTTY === true;
        const signal = ctx.io.signal;

        let previous: AnalysisResult | null = null;
        let running = false;
        let pending = false;
        let timer: NodeJS.Timeout | null = null;
        let changes = 0;
        let polling = false;

        const excluder = new Excluder({
            patterns: options.exclude ?? [],
            defaultExcludes: options.defaultExcludes ?? true,
        });

        const render = async (result: AnalysisResult): Promise<void> => {
            if (display.format === 'json') {
                await ctx.stdout(`${JSON.stringify(result)}\n`);
                return;
            }
            if (clear) await ctx.stdout(CLEAR_SCREEN);
            await emit(
                ctx,
                result,
                { ...display, html: undefined, csv: undefined },
                listLimit(options.top)
            );
            const status = previous
                ? describeChange(previous, result, display.units)
                : 'initial scan';
            ctx.info(
                ctx.err.dim(
                    `watching ${target} · ${status} · ${new Date().toLocaleTimeString()} · Ctrl+C to stop`
                ),
                display.quiet
            );
        };

        let watcher: TreeWatcher | null = null;
        const run = async (): Promise<void> => {
            if (running) {
                pending = true;
                return;
            }
            running = true;
            try {
                for (;;) {
                    pending = false;
                    const result = await runAnalysis(ctx, target, options, {
                        ...display,
                        progress: display.progress && previous === null,
                    });
                    if (
                        !polling ||
                        !previous ||
                        changes > 0 ||
                        fingerprint(previous) !== fingerprint(result)
                    ) {
                        await render(result);
                    }
                    previous = result;
                    changes = 0;
                    if (watcher && !watcher.recursive) {
                        watcher.sync(await listDirectories(target, options));
                    }
                    if (!pending || signal?.aborted) break;
                }
            } catch (error) {
                if (error instanceof AbortError) return;
                ctx.io.stderr.write(`${ctx.err.red('error')} ${errorMessage(error)}\n`);
            } finally {
                running = false;
            }
        };

        const schedule = (): void => {
            changes++;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void run(), debounce);
        };

        await run();
        if (signal?.aborted) return;

        let poller: NodeJS.Timeout | null = null;
        const startPolling = (seconds: number): void => {
            polling = true;
            poller = setInterval(() => void run(), seconds * 1000);
        };
        if (pollSeconds) {
            startPolling(pollSeconds);
        } else {
            watcher = new TreeWatcher({
                root: target,
                isIgnored: (rel) => excluder.isPathExcluded(rel),
                onChange: schedule,
                onError: (error) => {
                    ctx.warn(
                        `file watching failed (${error.message}); falling back to polling every 5 seconds`
                    );
                    watcher?.close();
                    watcher = null;
                    if (!poller) startPolling(5);
                },
            });
            watcher.sync(watcher.recursive ? [] : await listDirectories(target, options));
        }

        await new Promise<void>((resolve) => {
            if (!signal) return; // without a signal the process runs until killed
            if (signal.aborted) resolve();
            signal.addEventListener('abort', () => resolve(), { once: true });
        });
        if (timer) clearTimeout(timer);
        if (poller) clearInterval(poller);
        watcher?.close();
    });
}

function fingerprint(result: AnalysisResult): string {
    const s = result.summary;
    return `${s.bytes}:${s.files}:${s.directories}:${result.largestFiles.map((f) => `${f.path}@${f.modified}`).join('|')}`;
}

function describeChange(
    previous: AnalysisResult,
    current: AnalysisResult,
    units: 'iec' | 'si'
): string {
    const bytes = current.summary.bytes - previous.summary.bytes;
    const files = current.summary.files - previous.summary.files;
    if (bytes === 0 && files === 0) return 'no size change';
    const parts: string[] = [];
    if (bytes !== 0) parts.push(`${bytes > 0 ? '+' : ''}${formatBytes(bytes, units)}`);
    if (files !== 0) parts.push(`${files > 0 ? '+' : ''}${formatCount(files)} files`);
    return parts.join(', ');
}
