import { InvalidArgumentError, Option, type Command } from 'commander';
import type { DatConfig } from '../config/schema.ts';
import { errorMessage } from '../errors.ts';
import type { AnalyzeOptions } from '../core/analyze.ts';
import { parseBudget } from '../core/budgets.ts';
import type { ScanSettings } from '../core/options.ts';
import { parseSize, type ByteUnits } from '../format/bytes.ts';
import { parsePointInTime } from '../format/time.ts';
import { FORMATS, type Format } from '../reporters/index.ts';

const SCAN_GROUP = 'Scan options:';
const REPORT_GROUP = 'Report options:';
const OUTPUT_GROUP = 'Output options:';

/** Commander parser for whole numbers of at least `min`. */
export function integer(min: number): (value: string) => number {
    return (value: string): number => {
        const parsed = Number(value);
        if (!/^\s*-?\d+\s*$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min) {
            throw new InvalidArgumentError(`Expected a whole number of at least ${min}.`);
        }
        return parsed;
    };
}

function validated(check: (value: string) => unknown) {
    return (value: string): string => {
        // An empty value comes from a bare optional flag ("-l"); see normalizeArgv.
        if (value === '') return value;
        try {
            check(value);
        } catch (error) {
            throw new InvalidArgumentError(errorMessage(error));
        }
        return value;
    };
}

function collect(validate?: (value: string) => unknown) {
    return (value: string, previous: string[] | undefined): string[] => {
        if (validate) validated(validate)(value);
        return [...(previous ?? []), value];
    };
}

const size = validated(parseSize);
const pointInTime = validated((v) => parsePointInTime(v));

function option(flags: string, description: string, group: string): Option {
    return new Option(flags, description).helpGroup(group);
}

/** Options that control which files are scanned. Shared by every command. */
export function addScanOptions(command: Command): Command {
    return command
        .addOption(
            option(
                '-e, --exclude <pattern>',
                'skip paths matching a gitignore-style pattern (repeatable)',
                SCAN_GROUP
            ).argParser(collect())
        )
        .addOption(
            option(
                '-a, --all',
                'include .git, .hg, .svn, and node_modules (skipped by default)',
                SCAN_GROUP
            )
        )
        .addOption(option('--no-default-excludes', 'same as --all', SCAN_GROUP).hideHelp())
        .addOption(
            option(
                '--default-excludes',
                'skip .git, .hg, .svn, and node_modules',
                SCAN_GROUP
            ).hideHelp()
        )
        .addOption(option('-g, --gitignore', 'honor .gitignore files', SCAN_GROUP))
        .addOption(option('--no-gitignore', 'ignore .gitignore files', SCAN_GROUP).hideHelp())
        .addOption(
            option(
                '--max-depth <n>',
                'descend at most n levels (0 = only top-level files)',
                SCAN_GROUP
            ).argParser(integer(0))
        )
        .addOption(option('--no-recursive', 'same as --max-depth 0', SCAN_GROUP).hideHelp())
        .addOption(
            option(
                '-L, --follow-symlinks',
                'follow symbolic links (cycles are detected)',
                SCAN_GROUP
            )
        )
        .addOption(
            option(
                '--count-hardlinks',
                'count every hard link instead of shared data once',
                SCAN_GROUP
            )
        )
        .addOption(
            option(
                '--min-size <size>',
                'only files at least this large (e.g. 10k, 5MiB, 1GB)',
                SCAN_GROUP
            ).argParser(size)
        )
        .addOption(
            option('--max-size <size>', 'only files at most this large', SCAN_GROUP).argParser(size)
        )
        .addOption(
            option(
                '--newer-than <when>',
                'only files modified after an age (30d) or date (2024-01-31)',
                SCAN_GROUP
            ).argParser(pointInTime)
        )
        .addOption(
            option(
                '--older-than <when>',
                'only files modified before an age or date (inclusive)',
                SCAN_GROUP
            ).argParser(pointInTime)
        )
        .addOption(
            option('--date-from <date>', 'alias of --newer-than', SCAN_GROUP)
                .argParser(pointInTime)
                .hideHelp()
        )
        .addOption(
            option('--date-to <date>', 'alias of --older-than', SCAN_GROUP)
                .argParser(pointInTime)
                .hideHelp()
        )
        .addOption(
            option(
                '-c, --config <file>',
                'use this config file instead of discovering one',
                SCAN_GROUP
            )
        )
        .addOption(option('--no-config', 'ignore config files', SCAN_GROUP));
}

/** Options that turn reports on or off. */
export function addReportOptions(command: Command): Command {
    return command
        .addOption(
            option(
                '-n, --top <n>',
                'length of the largest files and folders lists (default: 10)',
                REPORT_GROUP
            ).argParser(integer(0))
        )
        .addOption(
            option('--top-n <n>', 'alias of --top', REPORT_GROUP).argParser(integer(0)).hideHelp()
        )
        .addOption(
            option(
                '-l, --large-files [size]',
                'list files at least this large (default: 100MiB)',
                REPORT_GROUP
            ).argParser(size)
        )
        .addOption(option('-d, --duplicates', 'find files with identical contents', REPORT_GROUP))
        .addOption(
            option(
                '--no-duplicates',
                'turn off duplicate detection from a config file',
                REPORT_GROUP
            ).hideHelp()
        )
        .addOption(
            option(
                '--min-duplicate-size <size>',
                'ignore smaller files when finding duplicates',
                REPORT_GROUP
            ).argParser(size)
        )
        .addOption(option('--empty', 'list empty files and folders', REPORT_GROUP))
        .addOption(option('--empty-files', 'alias of --empty', REPORT_GROUP).hideHelp())
        .addOption(option('--no-empty', 'turn off the empty report', REPORT_GROUP).hideHelp())
        .addOption(
            option(
                '--stale [when]',
                'list files not modified since an age or date (default: 1y)',
                REPORT_GROUP
            ).argParser(pointInTime)
        )
        .addOption(option('-x, --extensions', 'show the breakdown by file extension', REPORT_GROUP))
        .addOption(
            option('--no-extensions', 'hide the extension breakdown', REPORT_GROUP).hideHelp()
        )
        .addOption(option('--no-types', 'hide the breakdown by file type', REPORT_GROUP))
        .addOption(option('-t, --tree', 'show a size tree', REPORT_GROUP))
        .addOption(option('--no-tree', 'hide the size tree', REPORT_GROUP).hideHelp())
        .addOption(
            option(
                '--tree-depth <n>',
                'levels shown by --tree (default: 3)',
                REPORT_GROUP
            ).argParser(integer(1))
        )
        .addOption(
            option(
                '-b, --budget <rule>',
                'fail with exit code 2 unless a rule holds, e.g. "size<=500MB" (repeatable)',
                REPORT_GROUP
            ).argParser(collect(parseBudget))
        );
}

/** Options that control how results are printed. */
export function addOutputOptions(command: Command, formats: readonly Format[] = FORMATS): Command {
    return command
        .addOption(option('-f, --format <format>', 'output format', OUTPUT_GROUP).choices(formats))
        .addOption(option('-j, --json', 'same as --format json', OUTPUT_GROUP))
        .addOption(
            option(
                '-o, --output <file>',
                'write the report to a file instead of stdout',
                OUTPUT_GROUP
            )
        )
        .addOption(
            option('--si', 'use decimal units (kB, MB) instead of binary (KiB, MiB)', OUTPUT_GROUP)
        )
        .addOption(option('--color', 'force colors', OUTPUT_GROUP))
        .addOption(option('--no-color', 'disable colors (also honors NO_COLOR)', OUTPUT_GROUP))
        .addOption(option('--no-progress', 'hide the progress line', OUTPUT_GROUP))
        .addOption(option('-q, --quiet', 'print only the report and errors', OUTPUT_GROUP));
}

/** Legacy file outputs kept from v2: they write a file in addition to the normal output. */
export function addFileReportOptions(command: Command): Command {
    return command
        .addOption(option('--html [file]', 'also write a self-contained HTML report', OUTPUT_GROUP))
        .addOption(option('--csv [file]', 'also write a CSV export', OUTPUT_GROUP));
}

/** Option values the user actually typed, so config values are only overridden explicitly. */
export function explicitOptions(command: Command): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(command.opts())) {
        const source = command.getOptionValueSource(key);
        if (source === 'cli' || source === 'env' || source === 'implied') values[key] = value;
    }
    return values;
}

/** Typed readers for loosely typed commander values. */
export const read = {
    string: (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined),
    number: (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined),
    boolean: (value: unknown): boolean | undefined =>
        typeof value === 'boolean' ? value : undefined,
    strings: (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [],
    /** `--flag` alone (or an empty value) means true; otherwise the given string. */
    flag: (value: unknown): string | true | undefined =>
        value === true || value === '' ? true : typeof value === 'string' ? value : undefined,
};

/** Merges config values with explicit CLI flags (flags win) into scan settings. */
export function resolveScanSettings(cli: Record<string, unknown>, config: DatConfig): ScanSettings {
    let defaultExcludes = config.defaultExcludes;
    if (cli['all'] === true) defaultExcludes = false;
    else defaultExcludes = read.boolean(cli['defaultExcludes']) ?? defaultExcludes;

    let maxDepth = config.maxDepth;
    if (cli['recursive'] === false) maxDepth = 0;
    maxDepth = read.number(cli['maxDepth']) ?? maxDepth;

    return {
        exclude: [...(config.exclude ?? []), ...read.strings(cli['exclude'])],
        defaultExcludes,
        gitignore: read.boolean(cli['gitignore']) ?? config.gitignore,
        maxDepth,
        followSymlinks: read.boolean(cli['followSymlinks']) ?? config.followSymlinks,
        countHardlinks: read.boolean(cli['countHardlinks']) ?? config.countHardlinks,
        minSize: read.string(cli['minSize']) ?? config.minSize,
        maxSize: read.string(cli['maxSize']) ?? config.maxSize,
        modifiedAfter:
            read.string(cli['newerThan']) ?? read.string(cli['dateFrom']) ?? config.newerThan,
        modifiedBefore:
            read.string(cli['olderThan']) ?? read.string(cli['dateTo']) ?? config.olderThan,
    };
}

/** Merges config values with explicit CLI flags into full analysis options. */
export function resolveAnalyzeOptions(
    cli: Record<string, unknown>,
    config: DatConfig
): AnalyzeOptions {
    const emptyFlag = read.boolean(cli['empty']) ?? (cli['emptyFiles'] === true ? true : undefined);
    const treeDepth = read.number(cli['treeDepth']) ?? config.treeDepth;
    const tree =
        read.boolean(cli['tree']) ??
        config.tree ??
        (cli['treeDepth'] === undefined ? undefined : true);

    return {
        ...resolveScanSettings(cli, config),
        top: read.number(cli['top']) ?? read.number(cli['topN']) ?? config.top,
        largeFiles: read.flag(cli['largeFiles']) ?? config.largeFiles,
        duplicates: read.boolean(cli['duplicates']) ?? config.duplicates,
        minDuplicateSize: read.string(cli['minDuplicateSize']) ?? config.minDuplicateSize,
        empty: emptyFlag ?? config.empty,
        stale: read.flag(cli['stale']) ?? config.stale,
        tree: tree === true ? { depth: treeDepth } : false,
        budgets: [...(config.budgets ?? []), ...read.strings(cli['budget'])],
    };
}

export interface DisplaySettings {
    format: Format;
    output: string | undefined;
    units: ByteUnits;
    color: boolean | undefined;
    progress: boolean;
    quiet: boolean;
    types: boolean;
    extensions: boolean;
    html: string | true | undefined;
    csv: string | true | undefined;
}

export function resolveDisplay(cli: Record<string, unknown>, config: DatConfig): DisplaySettings {
    const format =
        cli['json'] === true ? 'json' : (FORMATS.find((f) => f === cli['format']) ?? 'pretty');
    return {
        format,
        output: read.string(cli['output']),
        units: cli['si'] === true ? 'si' : (config.units ?? 'iec'),
        color: read.boolean(cli['color']),
        progress: cli['progress'] !== false && cli['quiet'] !== true,
        quiet: cli['quiet'] === true,
        types: cli['types'] !== false,
        extensions: read.boolean(cli['extensions']) ?? config.extensions ?? false,
        html: read.flag(cli['html']),
        csv: read.flag(cli['csv']),
    };
}
