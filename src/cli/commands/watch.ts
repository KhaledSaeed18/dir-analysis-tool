import { stat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { Option, type Command } from '../command.ts';
import { Excluder } from '../../core/exclude.ts';
import { LiveAnalysis } from '../../core/live.ts';
import { assertDirectory, listDirectories } from '../../core/options.ts';
import { AbortError, errorMessage } from '../../errors.ts';
import { formatBytes } from '../../format/bytes.ts';
import {
    escapeControl,
    escapeControlInLines,
    formatCount,
    stringifyJson,
} from '../../format/text.ts';
import type { AnalysisResult } from '../../types.ts';
import { analyze, type AnalyzeOptions } from '../../core/analyze.ts';
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
import { checkOutputs, emit, listLimit, runAnalysis } from './analyze.ts';

const CLEAR_SCREEN = '\u001B[2J\u001B[3J\u001B[H';
/**
 * Events can be lost without a word (a full kernel queue, a sleeping laptop), so while changes keep
 * coming, a report is a full scan again at least this often.
 */
export const FULL_SCAN_EVERY_MS: number = 10 * 60 * 1000;

/** Whether the next report must come from a full scan instead of the changed folders. */
export function needsFullScan(lastFullScan: number, now: number): boolean {
    return now - lastFullScan >= FULL_SCAN_EVERY_MS;
}

const EXAMPLES = `
Examples:
  $ dat watch                          re-analyze the current directory on every change
  $ dat watch ./downloads -l 1GB       keep an eye on large downloads
  $ dat watch . --json | jq -c .summary
                                       one JSON document per line (NDJSON)
  $ dat watch . -j -o report.json      keep report.json up to date
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
                're-scan this many seconds after each scan ends, instead of using filesystem events'
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

        // One check before the first scan and before any watcher: a root that is missing or not a
        // directory is an error (exit 1), not something to watch or poll for.
        await assertDirectory(target);
        await checkOutputs(ctx, { ...display, html: undefined, csv: undefined });

        let previous: AnalysisResult | null = null;
        let previousKey = '';
        let running = false;
        let pending = false;
        let timer: NodeJS.Timeout | null = null;
        let changes = 0;
        let polling = pollSeconds !== undefined;
        let rootGone = false;
        let rootCheck: NodeJS.Timeout | null = null;
        // Event mode updates the report from the folders that changed (#34); polling has no events
        // to go on and scans in full. Options that rule it out (-L, relative dates) also scan in full.
        let incremental = pollSeconds === undefined;
        let live: LiveAnalysis | null = null;
        let lastFullScan = 0;
        const changed = new Set<string>();

        const excluder = new Excluder({
            patterns: options.exclude ?? [],
            defaultExcludes: options.defaultExcludes ?? true,
        });
        // Events for the report dat itself writes (-o inside the watched folder) are not changes;
        // otherwise every write would start a new scan and another write.
        let ownFiles = new Set<string>();

        const render = async (result: AnalysisResult): Promise<void> => {
            if (display.format === 'json' && !display.output) {
                await ctx.stdout(`${stringifyJson(result)}\n`);
                return;
            }
            if (clear) await ctx.stdout(CLEAR_SCREEN);
            await emit(
                ctx,
                result,
                { ...display, html: undefined, csv: undefined },
                listLimit(options.top)
            );
            if (display.format === 'json') return;
            const status = previous
                ? describeChange(previous, result, display.units)
                : 'initial scan';
            ctx.info(
                ctx.err.dim(
                    `watching ${escapeControl(target)} · ${status} · ${new Date().toLocaleTimeString()} · Ctrl+C to stop`
                ),
                display.quiet
            );
        };

        // Ends the watch when the reader of stdout goes away (`dat watch --json | head -1`). Only a
        // stream that was written to can be found closed, so reports written with -o never end it.
        let stopWatching = (): void => {};
        const stopped = new Promise<void>((resolve) => (stopWatching = resolve));
        const readerGone = (): boolean => ctx.stdoutClosed;

        let watcher: TreeWatcher | null = null;
        let poller: NodeJS.Timeout | null = null;
        let finished = false;
        /** The run in progress, so a poll can wait for it before counting its idle time. */
        let active: Promise<void> = Promise.resolve();
        const closeWatcher = (): void => {
            watcher?.close();
            watcher = null;
        };

        const schedule = (path?: string): void => {
            changes++;
            if (path !== undefined) changed.add(path);
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void run(), debounce);
        };

        // The first scan, or the first after the root came back: keeps per-folder state from then on.
        const startLive = async (
            path: string,
            settings: AnalyzeOptions
        ): Promise<AnalysisResult> => {
            const created = await LiveAnalysis.create(path, settings);
            if (!created) {
                incremental = false;
                return analyze(path, settings);
            }
            live = created.live;
            return created.update.result;
        };

        const startPolling = (seconds: number): void => {
            polling = true;
            incremental = false;
            live = null;
            if (rootCheck) clearInterval(rootCheck);
            rootCheck = null;
            // The interval is idle time after each scan, never time from one start to the next: a
            // scan that takes longer than the interval would otherwise run again at once, forever.
            const tick = async (): Promise<void> => {
                // Resolves when the run in progress, if any, has finished too.
                await run();
                if (!finished && !signal?.aborted) {
                    poller = setTimeout(() => void tick(), seconds * 1000);
                }
            };
            poller = setTimeout(() => void tick(), seconds * 1000);
        };

        // The root was deleted (or replaced by a file): say so once, stop watching, and wait for it
        // to be a directory again (see checkRoot; with --poll, each poll checks).
        const markRootGone = (): void => {
            if (rootGone) return;
            rootGone = true;
            ctx.warn(
                `${escapeControl(target)} was removed; waiting for it to come back (Ctrl+C to stop)`
            );
            closeWatcher();
        };

        // Watchers don't report the deletion of their own root on every platform (Windows keeps a
        // watched folder's delete pending), so event mode also checks the root once a second.
        const checkRoot = async (): Promise<void> => {
            if (running) return;
            if (rootGone || !(await isDirectory(target))) await run();
        };

        const watchFailed = async (failed: TreeWatcher, error: Error): Promise<void> => {
            failed.close();
            if (watcher === failed) watcher = null;
            // A deleted root is handled by the next run, never by polling for it.
            if (!(await isDirectory(target))) {
                schedule();
                return;
            }
            ctx.warn(
                `file watching failed (${escapeControl(error.message)}); falling back to polling every 5 seconds`
            );
            if (!poller) startPolling(5);
        };

        const syncWatcher = async (): Promise<void> => {
            if (polling || signal?.aborted) return;
            if (!watcher) {
                if (display.output) {
                    ownFiles = await ownFileEvents(target, ctx.resolvePath(display.output));
                }
                const created: TreeWatcher = new TreeWatcher({
                    root: target,
                    isIgnored: (rel) => ownFiles.has(rel) || excluder.isPathExcluded(rel),
                    onChange: (path) => schedule(path),
                    onError: (error) => void watchFailed(created, error),
                });
                watcher = created;
                if (created.recursive) {
                    created.sync([]);
                    return;
                }
            }
            if (watcher && !watcher.recursive) {
                watcher.sync(live ? live.directories : await listDirectories(target, options));
            }
        };

        const scan = async (): Promise<AnalysisResult | null> => {
            if (!(await isDirectory(target))) {
                markRootGone();
                return null;
            }
            if (rootGone) {
                rootGone = false;
                changes++;
                live = null; // what came back is a new tree
            }
            const paths = [...changed];
            changed.clear();
            try {
                if (incremental && live && !needsFullScan(lastFullScan, Date.now())) {
                    const update = await live.update(paths);
                    if (update.mode === 'full') lastFullScan = Date.now();
                    return update.result;
                }
                lastFullScan = Date.now();
                if (incremental && live) return (await live.rescan()).result;
                return await runAnalysis(
                    ctx,
                    target,
                    options,
                    { ...display, progress: display.progress && previous === null },
                    incremental ? startLive : undefined
                );
            } catch (error) {
                // Deleted while the scan ran.
                if (!(error instanceof AbortError) && !(await isDirectory(target))) {
                    markRootGone();
                    return null;
                }
                throw error;
            }
        };

        const run = (initial = false): Promise<void> => {
            if (running) {
                pending = true;
                return active;
            }
            active = runLoop(initial);
            return active;
        };

        const runLoop = async (initial: boolean): Promise<void> => {
            running = true;
            try {
                for (;;) {
                    pending = false;
                    const result = await scan();
                    if (!result) break;
                    // Relative cutoffs (--stale 1y) and timings differ on every scan; nothing else
                    // may change without a new report.
                    const key = reportKey(result);
                    if (!polling || !previous || changes > 0 || key !== previousKey) {
                        await render(result);
                        if (readerGone()) {
                            stopWatching();
                            break;
                        }
                    }
                    previous = result;
                    previousKey = key;
                    changes = 0;
                    try {
                        await syncWatcher();
                    } catch (error) {
                        if (await isDirectory(target)) throw error;
                        markRootGone();
                        break;
                    }
                    if (!pending || signal?.aborted) break;
                }
            } catch (error) {
                if (error instanceof AbortError) return;
                if (initial) throw error;
                ctx.io.stderr.write(
                    `${ctx.err.red('error')} ${escapeControlInLines(errorMessage(error))}\n`
                );
            } finally {
                running = false;
            }
        };

        await run(true);
        if (!signal?.aborted && !readerGone()) {
            if (pollSeconds) startPolling(pollSeconds);
            else rootCheck = setInterval(() => void checkRoot(), 1000);
            await Promise.race([
                stopped,
                new Promise<void>((resolve) => {
                    if (!signal) return; // without a signal the process runs until killed or stopped
                    if (signal.aborted) resolve();
                    signal.addEventListener('abort', () => resolve(), { once: true });
                }),
            ]);
        }
        if (timer) clearTimeout(timer);
        finished = true;
        if (poller) clearTimeout(poller);
        if (rootCheck) clearInterval(rootCheck);
        closeWatcher();
        // Ctrl+C is how a watch normally ends, and it exits 130 like every other command.
        if (signal?.aborted) throw new AbortError();
    });
}

/** The result without the fields that change on every scan even when nothing on disk did. */
function reportKey(result: AnalysisResult): string {
    const {
        startedAt: _startedAt,
        durationMs: _durationMs,
        settings,
        staleFiles,
        ...rest
    } = result;
    return stringifyJson({
        ...rest,
        settings: { ...settings, modifiedAfter: null, modifiedBefore: null },
        staleFiles: staleFiles && { ...staleFiles, modifiedBefore: '' },
    });
}

async function isDirectory(path: string): Promise<boolean> {
    return stat(path).then(
        (stats) => stats.isDirectory(),
        () => false
    );
}

/**
 * The root-relative `/` paths under which the watcher may report `file`: as given, and through
 * real paths, since FSEvents can report `/private/var` for a root under `/var`.
 */
async function ownFileEvents(root: string, file: string): Promise<Set<string>> {
    const paths = new Set<string>();
    const add = (base: string, path: string): void => {
        const rel = relative(base, path);
        if (rel && !rel.startsWith('..') && !isAbsolute(rel)) paths.add(rel.split(sep).join('/'));
    };
    add(root, file);
    const realRoot = await realpath(root).catch(() => root);
    const realDir = await realpath(dirname(file)).catch(() => dirname(file));
    add(realRoot, join(realDir, basename(file)));
    return paths;
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
    if (files !== 0) {
        parts.push(
            `${files > 0 ? '+' : ''}${formatCount(files)} ${Math.abs(files) === 1 ? 'file' : 'files'}`
        );
    }
    return parts.join(', ');
}
