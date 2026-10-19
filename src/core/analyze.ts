import type { Stats } from 'node:fs';
import { DatError, errorMessage } from '../errors.ts';
import { parsePointInTime } from '../format/time.ts';
import { TOOL } from '../version.ts';
import {
    type AnalysisResult,
    type Category,
    type DirectoryEntry,
    type DuplicateGroup,
    type FileEntry,
    type SizeStat,
    type TreeNode,
} from '../types.ts';
import { evaluateBudgets, parseBudget, requiredFeatures, type Budget } from './budgets.ts';
import { classify, emptyTypeStats, extensionOf } from './classify.ts';
import { findDuplicates, type DuplicateCandidate, type DuplicateProgress } from './duplicates.ts';
import { resolveScan, toBytes, type ScanSettings } from './options.ts';
import { rollUp, Scanner, type DirNode, type ScanCounters, type ScanVisitor } from './scanner.ts';
import { comparePaths, joinRelative } from './paths.ts';
import { TopK } from './top.ts';

/** Default size for "large file" detection: 100 MiB. */
export const DEFAULT_LARGE_FILE_THRESHOLD: number = 100 * 1024 * 1024;
/** Default age for stale-file detection. */
export const DEFAULT_STALE_AGE: string = '1y';
/** A directory is folded into its largest child when that child holds this share of its size. */
const PASS_THROUGH_SHARE = 0.95;

export interface AnalyzeOptions extends ScanSettings {
    /** Length of the largest-files and largest-directories lists. Default: 10. `0` disables them. */
    top?: number | undefined;
    /** Report files at least this large. `true` uses 100 MiB. */
    largeFiles?: boolean | number | string | undefined;
    /** Find files with identical contents. */
    duplicates?: boolean | undefined;
    /** Ignore files smaller than this when looking for duplicates. Default: 1 byte. */
    minDuplicateSize?: number | string | undefined;
    /** Report empty files and empty directories. */
    empty?: boolean | undefined;
    /** Report files not modified since this time (or age). `true` uses one year. */
    stale?: boolean | number | string | Date | undefined;
    /** Build a size tree. */
    tree?: boolean | { depth?: number | undefined; limit?: number | undefined } | undefined;
    /** Size budgets such as `size<=500MB`; results land in `result.budgets`. */
    budgets?: readonly string[] | undefined;
    /** Called periodically with live counters while the analysis runs. */
    onProgress?: ((progress: AnalysisProgress) => void) | undefined;
    /** Milliseconds between progress callbacks. Default: 100. */
    progressInterval?: number | undefined;
}

export type AnalysisProgress =
    | {
          phase: 'scan';
          files: number;
          directories: number;
          bytes: number;
          errors: number;
      }
    | ({ phase: 'hash'; files: number; bytes: number } & DuplicateProgress);

interface FileRef {
    dir: number;
    name: string;
    bytes: number;
    mtimeMs: number;
}

interface Candidate extends DuplicateCandidate {
    mtimeMs: number;
}

interface Features {
    top: number;
    largeThreshold: number | null;
    duplicates: boolean;
    minDuplicateSize: number;
    empty: boolean;
    staleBefore: number | null;
    tree: { depth: number; limit: number } | null;
    budgets: Budget[];
}

/**
 * Analyzes a directory tree in a single pass.
 *
 * Memory stays bounded by default: totals, type and extension statistics,
 * and top-N lists are computed while scanning. Opt-in reports (large, empty,
 * and stale files) hold only matching entries; duplicate detection holds one
 * small record per file that shares its size with another.
 *
 * @example
 * ```ts
 * import { analyze } from 'dir-analysis-tool';
 *
 * const result = await analyze('.', { duplicates: true, top: 5 });
 * console.log(result.summary.bytes, result.duplicates?.wastedBytes);
 * ```
 */
export async function analyze(path: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
    const startedAt = Date.now();
    const started = performance.now();
    const features = resolveFeatures(options, startedAt);
    const { options: scanOptions, settings } = await resolveScan(path, options, startedAt);

    const collector = new Collector(features);
    const scanner = new Scanner(scanOptions, collector);
    collector.attach(scanner);

    const report = options.onProgress;
    const progress = createProgressReporter<AnalysisProgress>(
        report,
        options.progressInterval,
        () => ({
            phase: 'scan',
            files: scanner.counters.files,
            directories: scanner.counters.directories,
            bytes: scanner.counters.bytes,
            errors: scanner.counters.errors,
        })
    );

    try {
        await scanner.run();
        progress.flush();
        rollUp(scanner.dirs);

        let duplicates: AnalysisResult['duplicates'];
        if (features.duplicates) {
            progress.stop();
            // Hashing reports per file; forward at most one update per interval, plus each stage's end.
            const interval = options.progressInterval ?? 100;
            let last = 0;
            duplicates = await collector.findDuplicates(
                scanOptions.concurrency,
                scanOptions.signal,
                (p) => {
                    if (!report) return;
                    const now = performance.now();
                    if (p.done !== p.total && p.done !== 0 && now - last < interval) return;
                    last = now;
                    report({
                        phase: 'hash',
                        files: scanner.counters.files,
                        bytes: scanner.counters.bytes,
                        ...p,
                    });
                }
            );
        }

        const result = collector.build(scanner, {
            root: scanOptions.root,
            startedAt,
            settings,
            duplicates,
        });
        if (features.budgets.length > 0) result.budgets = evaluateBudgets(features.budgets, result);
        result.durationMs = Math.round(performance.now() - started);
        return result;
    } finally {
        progress.stop();
    }
}

function resolveFeatures(options: AnalyzeOptions, now: number): Features {
    const top = options.top ?? 10;
    if (!Number.isInteger(top) || top < 0) {
        throw new DatError(`top must be a non-negative integer (got ${top}).`);
    }

    let budgets: Budget[];
    try {
        budgets = (options.budgets ?? []).map(parseBudget);
    } catch (error) {
        throw new DatError(errorMessage(error));
    }
    const required = requiredFeatures(budgets);

    let largeThreshold: number | null = null;
    if (
        options.largeFiles === true ||
        (options.largeFiles === undefined && required.has('largeFiles'))
    ) {
        largeThreshold = DEFAULT_LARGE_FILE_THRESHOLD;
    } else if (options.largeFiles !== undefined && options.largeFiles !== false) {
        largeThreshold = toBytes(options.largeFiles, 'largeFiles');
    }

    let staleBefore: number | null = null;
    const stale = options.stale ?? (required.has('stale') ? true : undefined);
    if (stale !== undefined && stale !== false) {
        if (stale === true) staleBefore = parsePointInTime(DEFAULT_STALE_AGE, { now });
        else if (stale instanceof Date) staleBefore = stale.getTime();
        else if (typeof stale === 'number') staleBefore = stale;
        else {
            try {
                staleBefore = parsePointInTime(stale, { now, endOfDay: true });
            } catch (error) {
                throw new DatError(`stale: ${errorMessage(error)}`);
            }
        }
    }

    let tree: Features['tree'] = null;
    if (options.tree) {
        const config = options.tree === true ? {} : options.tree;
        const depth = config.depth ?? 3;
        const limit = config.limit ?? Math.max(top, 10);
        if (!Number.isInteger(depth) || depth < 1) {
            throw new DatError(`tree depth must be a positive integer (got ${depth}).`);
        }
        if (!Number.isInteger(limit) || limit < 1) {
            throw new DatError(`tree limit must be a positive integer (got ${limit}).`);
        }
        tree = { depth, limit };
    }

    return {
        top,
        largeThreshold,
        duplicates: options.duplicates === true || required.has('duplicates'),
        minDuplicateSize: Math.max(1, toBytes(options.minDuplicateSize, 'minDuplicateSize') ?? 1),
        empty: options.empty === true || required.has('empty'),
        staleBefore,
        tree,
        budgets,
    };
}

/** Collects every statistic during the scan. One instance per analysis. */
class Collector implements ScanVisitor {
    readonly #features: Features;
    #scanner: Scanner | null = null;

    readonly #types: Record<Category, SizeStat> = emptyTypeStats();
    readonly #extensions = new Map<string, SizeStat>();
    #largestFileBytes = 0;
    readonly #topFiles: TopK<FileRef>;
    readonly #large: { refs: FileRef[]; bytes: number } = { refs: [], bytes: 0 };
    readonly #empty: FileRef[] = [];
    readonly #stale: { refs: FileRef[]; bytes: number } = { refs: [], bytes: 0 };
    /** Size -> candidates; a single candidate is stored unwrapped to save memory. */
    readonly #bySize = new Map<number, Candidate | Candidate[]>();
    /** Tree data: subdirectories and largest files of each directory shallower than the tree depth. */
    readonly #treeChildren = new Map<number, number[]>();
    readonly #treeFiles = new Map<number, TopK<FileRef>>();

    constructor(features: Features) {
        this.#features = features;
        this.#topFiles = new TopK(features.top, (a, b) => this.#compareRefs(a, b));
    }

    attach(scanner: Scanner): void {
        this.#scanner = scanner;
    }

    directory(index: number, node: DirNode): void {
        const tree = this.#features.tree;
        if (tree && node.parent >= 0 && node.depth <= tree.depth) {
            let siblings = this.#treeChildren.get(node.parent);
            if (!siblings) this.#treeChildren.set(node.parent, (siblings = []));
            siblings.push(index);
        }
    }

    file(dir: number, name: string, stats: Stats): void {
        const bytes = stats.size;
        const mtimeMs = stats.mtimeMs;
        const features = this.#features;

        const extension = extensionOf(name);
        const type = this.#types[classify(name, extension)];
        type.files++;
        type.bytes += bytes;
        const ext = this.#extensions.get(extension);
        if (ext) {
            ext.files++;
            ext.bytes += bytes;
        } else {
            this.#extensions.set(extension, { files: 1, bytes });
        }
        if (bytes > this.#largestFileBytes) this.#largestFileBytes = bytes;

        let ref: FileRef | undefined;
        const makeRef = (): FileRef => (ref ??= { dir, name, bytes, mtimeMs });

        if (this.#topFiles.accepts(bytes)) this.#topFiles.push(bytes, makeRef());
        if (features.largeThreshold !== null && bytes >= features.largeThreshold) {
            this.#large.refs.push(makeRef());
            this.#large.bytes += bytes;
        }
        if (features.empty && bytes === 0) this.#empty.push(makeRef());
        if (features.staleBefore !== null && mtimeMs < features.staleBefore) {
            this.#stale.refs.push(makeRef());
            this.#stale.bytes += bytes;
        }
        if (features.tree) {
            const depth = this.#scanner!.dirs[dir]!.depth;
            if (depth < features.tree.depth) {
                let heap = this.#treeFiles.get(dir);
                if (!heap) {
                    heap = new TopK(features.tree.limit, (a, b) => a.name.localeCompare(b.name));
                    this.#treeFiles.set(dir, heap);
                }
                if (heap.accepts(bytes)) heap.push(bytes, makeRef());
            }
        }
        if (features.duplicates && bytes >= features.minDuplicateSize) {
            const candidate: Candidate = {
                dir,
                name,
                bytes,
                mtimeMs,
                inode: `${stats.dev}:${stats.ino}`,
            };
            const existing = this.#bySize.get(bytes);
            if (existing === undefined) this.#bySize.set(bytes, candidate);
            else if (Array.isArray(existing)) existing.push(candidate);
            else this.#bySize.set(bytes, [existing, candidate]);
        }
    }

    async findDuplicates(
        concurrency: number,
        signal: AbortSignal | undefined,
        onProgress: (progress: DuplicateProgress) => void
    ): Promise<NonNullable<AnalysisResult['duplicates']>> {
        const scanner = this.#scanner!;
        const groups: Candidate[][] = [];
        for (const value of this.#bySize.values()) if (Array.isArray(value)) groups.push(value);
        this.#bySize.clear();

        const dirPaths = new Map<number, string>();
        const hashed = await findDuplicates(groups, {
            pathOf: (c) => {
                let dir = dirPaths.get(c.dir);
                if (dir === undefined) dirPaths.set(c.dir, (dir = scanner.absolutePath(c.dir)));
                return joinRelative(dir, c.name);
            },
            concurrency: Math.min(concurrency, 8),
            signal,
            onProgress,
            onError: (c, error) => scanner.recordError(scanner.relativePath(c.dir, c.name), error),
        });

        const items: DuplicateGroup[] = hashed.map((group) => {
            const files = group.members
                .map((m) => scanner.relativePath(m.dir, m.name))
                .sort(comparePaths);
            return {
                hash: group.hash,
                bytes: group.bytes,
                wastedBytes: group.bytes * (files.length - 1),
                files,
            };
        });
        items.sort(
            (a, b) => b.wastedBytes - a.wastedBytes || comparePaths(a.files[0]!, b.files[0]!)
        );

        let files = 0;
        let wastedBytes = 0;
        let bytes = 0;
        for (const group of items) {
            files += group.files.length;
            wastedBytes += group.wastedBytes;
            bytes += group.bytes * group.files.length;
        }
        return { count: items.length, files, bytes, wastedBytes, items };
    }

    build(
        scanner: Scanner,
        context: {
            root: string;
            startedAt: number;
            settings: AnalysisResult['settings'];
            duplicates: AnalysisResult['duplicates'];
        }
    ): AnalysisResult {
        const features = this.#features;
        const c: ScanCounters = scanner.counters;
        const toEntry = (ref: FileRef): FileEntry => ({
            path: scanner.relativePath(ref.dir, ref.name),
            bytes: ref.bytes,
            modified: new Date(ref.mtimeMs).toISOString(),
        });
        const bySizeThenPath = (a: FileEntry, b: FileEntry): number =>
            b.bytes - a.bytes || comparePaths(a.path, b.path);

        const result: AnalysisResult = {
            schemaVersion: 3,
            tool: TOOL,
            root: context.root,
            startedAt: new Date(context.startedAt).toISOString(),
            durationMs: 0,
            settings: context.settings,
            summary: {
                bytes: c.bytes,
                diskBytes: c.diskBytes,
                files: c.files,
                // The root itself is not counted as a folder.
                directories: c.directories - 1,
                largestFileBytes: this.#largestFileBytes,
                symlinks: c.symlinks,
                hardlinks: c.hardlinks,
                excluded: c.excluded,
                filtered: c.filtered,
                errors: c.errors,
            },
            types: this.#types,
            extensions: [...this.#extensions]
                .map(([extension, stat]) => ({ extension, ...stat }))
                .sort(
                    (a, b) =>
                        b.bytes - a.bytes ||
                        b.files - a.files ||
                        a.extension.localeCompare(b.extension)
                ),
            largestDirectories: this.#largestDirectories(scanner),
            largestFiles: this.#topFiles.sorted().map(toEntry),
            errors: [...scanner.errors].sort((a, b) => comparePaths(a.path, b.path)),
        };

        if (features.largeThreshold !== null) {
            result.largeFiles = {
                threshold: features.largeThreshold,
                count: this.#large.refs.length,
                bytes: this.#large.bytes,
                items: this.#large.refs.map(toEntry).sort(bySizeThenPath),
            };
        }
        if (context.duplicates) result.duplicates = context.duplicates;
        if (features.empty) {
            result.emptyFiles = {
                count: this.#empty.length,
                bytes: 0,
                items: this.#empty.map(toEntry).sort((a, b) => comparePaths(a.path, b.path)),
            };
            const emptyDirs: string[] = [];
            for (let i = 1; i < scanner.dirs.length; i++) {
                if (scanner.dirs[i]!.entries === 0) emptyDirs.push(scanner.relativePath(i));
            }
            result.emptyDirectories = {
                count: emptyDirs.length,
                items: emptyDirs.sort(comparePaths),
            };
        }
        if (features.staleBefore !== null) {
            result.staleFiles = {
                modifiedBefore: new Date(features.staleBefore).toISOString(),
                count: this.#stale.refs.length,
                bytes: this.#stale.bytes,
                items: this.#stale.refs.map(toEntry).sort(bySizeThenPath),
            };
        }
        if (features.tree) result.tree = this.#buildTree(scanner, 0, features.tree.limit, toEntry);
        return result;
    }

    #largestDirectories(scanner: Scanner): DirectoryEntry[] {
        const top = new TopK<number>(this.#features.top, (a, b) =>
            comparePaths(scanner.relativePath(a), scanner.relativePath(b))
        );
        const dirs = scanner.dirs;
        for (let i = 1; i < dirs.length; i++) {
            const node = dirs[i]!;
            if (node.bytes === 0) continue;
            // Fold pass-through folders into the subfolder that holds nearly all of their size.
            if (node.largestChild >= node.bytes * PASS_THROUGH_SHARE) continue;
            if (top.accepts(node.bytes)) top.push(node.bytes, i);
        }
        return top.sorted().map((i) => ({
            path: scanner.relativePath(i),
            bytes: dirs[i]!.bytes,
            files: dirs[i]!.files,
        }));
    }

    #buildTree(
        scanner: Scanner,
        index: number,
        limit: number,
        toEntry: (ref: FileRef) => FileEntry
    ): TreeNode {
        const node = scanner.dirs[index]!;
        const result: TreeNode = {
            name: index === 0 ? '.' : node.name,
            path: index === 0 ? '' : scanner.relativePath(index),
            type: 'directory',
            bytes: node.bytes,
            files: node.files,
        };
        const subdirs = this.#treeChildren.get(index);
        const files = this.#treeFiles.get(index);
        if (!subdirs && !files) return result;

        const candidates: Array<{ bytes: number; build: () => TreeNode; key: string }> = [];
        for (const child of subdirs ?? []) {
            candidates.push({
                bytes: scanner.dirs[child]!.bytes,
                key: scanner.dirs[child]!.name,
                build: () => this.#buildTree(scanner, child, limit, toEntry),
            });
        }
        for (const ref of files?.sorted() ?? []) {
            candidates.push({
                bytes: ref.bytes,
                key: ref.name,
                build: () => {
                    const entry = toEntry(ref);
                    return {
                        name: ref.name,
                        path: entry.path,
                        type: 'file',
                        bytes: ref.bytes,
                        files: 1,
                    };
                },
            });
        }
        candidates.sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
        const shown = candidates.slice(0, limit);
        result.children = shown.map((c) => c.build());

        const totalEntries = (subdirs?.length ?? 0) + node.ownFiles;
        const omittedEntries = totalEntries - shown.length;
        if (omittedEntries > 0) {
            let shownBytes = 0;
            let shownFiles = 0;
            for (const child of result.children) {
                shownBytes += child.bytes;
                shownFiles += child.files;
            }
            result.omitted = {
                entries: omittedEntries,
                files: node.files - shownFiles,
                bytes: node.bytes - shownBytes,
            };
        }
        return result;
    }

    #compareRefs(a: FileRef, b: FileRef): number {
        const scanner = this.#scanner!;
        return comparePaths(
            scanner.relativePath(a.dir, a.name),
            scanner.relativePath(b.dir, b.name)
        );
    }
}

interface ProgressReporter {
    flush(): void;
    stop(): void;
}

export function createProgressReporter<P>(
    report: ((progress: P) => void) | undefined,
    interval: number | undefined,
    snapshot: () => P
): ProgressReporter {
    if (!report) return { flush() {}, stop() {} };
    const timer = setInterval(() => report(snapshot()), interval ?? 100);
    timer.unref();
    let stopped = false;
    return {
        flush() {
            if (!stopped) report(snapshot());
        },
        stop() {
            stopped = true;
            clearInterval(timer);
        },
    };
}
