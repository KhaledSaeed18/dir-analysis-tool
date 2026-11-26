import type { Stats } from 'node:fs';
import { DatError, errorMessage } from '../errors.ts';
import { parsePointInTime } from '../format/time.ts';
import { TOOL } from '../version.ts';
import {
    CATEGORIES,
    type AnalysisResult,
    type Category,
    type DirectoryEntry,
    type DuplicateGroup,
    type FileEntry,
    type ScanError,
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

export interface FileRef {
    dir: number;
    name: string;
    bytes: number;
    mtimeMs: number;
}

/**
 * A duplicate candidate. Watch also keeps its timestamps and its digests, so
 * a file that did not change is never read again (see {@link DigestCache}).
 */
export interface Candidate extends DuplicateCandidate {
    mtimeMs?: number;
    ctimeMs?: number;
    digests?: { sample?: string; full?: string };
}

/** What a {@link Collector} needs from a scan: its folders, and how to name and order paths. */
export interface ScanTree {
    readonly dirs: readonly DirNode[];
    readonly counters: ScanCounters;
    readonly errors: readonly ScanError[];
    relativePath(dir: number, name?: string): string;
    absolutePath(dir: number, name?: string): string;
    compareRelative(
        dirA: number,
        nameA: string | undefined,
        dirB: number,
        nameB: string | undefined
    ): number;
    recordError(path: string, error: unknown): void;
}

/** What a {@link Collector} needs while it collects: folder depths, and how to order paths. */
export type CollectingTree = Pick<ScanTree, 'dirs' | 'compareRelative'>;

/** Remembers digests between runs, so watch re-hashes only files that changed. */
export interface DigestCache {
    get(candidate: Candidate, stage: DuplicateProgress['stage']): string | undefined;
    set(candidate: Candidate, stage: DuplicateProgress['stage'], digest: string): void;
}

/** Digests kept on the candidates themselves, for {@link Collector.findDuplicates}. */
export const CANDIDATE_DIGESTS: DigestCache = {
    get: (candidate, stage) => candidate.digests?.[stage],
    set: (candidate, stage, digest) => {
        (candidate.digests ??= {})[stage] = digest;
    },
};

export interface Features {
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
                scanner,
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

export function resolveFeatures(options: AnalyzeOptions, now: number): Features {
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

/**
 * Collects every statistic during the scan. One instance per analysis, or in
 * watch one per folder, merged into a fresh one with {@link absorb} for each report.
 */
export class Collector implements ScanVisitor {
    readonly #features: Features;
    readonly #stamps: boolean;
    #scanner: CollectingTree | null = null;

    // Everything below is created on first use: watch keeps a collector per folder, and most
    // folders fill only a few of these.
    /** File types with at least one file; `build` lists every type in the usual order. */
    #types: Partial<Record<Category, SizeStat>> | null = null;
    #extensions: Map<string, SizeStat> | null = null;
    #largestFileBytes = 0;
    #topFiles: TopK<FileRef> | null = null;
    #large: { refs: FileRef[]; bytes: number } | null = null;
    #empty: FileRef[] | null = null;
    #stale: { refs: FileRef[]; bytes: number } | null = null;
    /** Size -> candidates; a single candidate is stored unwrapped to save memory. */
    #bySize: Map<number, Candidate | Candidate[]> | null = null;
    /** Tree data: subdirectories and largest files of each directory shallower than the tree depth. */
    #treeChildren: Map<number, number[]> | null = null;
    #treeFiles: Map<number, TopK<FileRef>> | null = null;

    /** @param stamps Keep each duplicate candidate's timestamps (see {@link DigestCache}). */
    constructor(features: Features, stamps = false) {
        this.#features = features;
        this.#stamps = stamps;
    }

    #addType(category: Category, files: number, bytes: number): void {
        const types = (this.#types ??= {});
        const stat = types[category];
        if (stat) {
            stat.files += files;
            stat.bytes += bytes;
        } else {
            types[category] = { files, bytes };
        }
    }

    #addExtension(extension: string, files: number, bytes: number): void {
        const extensions = (this.#extensions ??= new Map());
        const stat = extensions.get(extension);
        if (stat) {
            stat.files += files;
            stat.bytes += bytes;
        } else {
            extensions.set(extension, { files, bytes });
        }
    }

    #pushTop(ref: FileRef): void {
        (this.#topFiles ??= new TopK(this.#features.top, (a, b) => this.#compareRefs(a, b))).push(
            ref.bytes,
            ref
        );
    }

    #acceptsTop(bytes: number): boolean {
        if (this.#features.top === 0) return false;
        return this.#topFiles?.accepts(bytes) ?? true;
    }

    attach(scanner: CollectingTree): void {
        this.#scanner = scanner;
    }

    /**
     * Adds everything `other` collected for a single folder, which it knew as
     * directory 0, as directory `dir` of this collector's tree. Lists and top-N
     * heaps merge to what one collector would have kept seeing every file.
     */
    absorb(other: Collector, dir: number): void {
        const move = (ref: FileRef): FileRef => ({ ...ref, dir });
        for (const category of CATEGORIES) {
            const stat = other.#types?.[category];
            if (stat) this.#addType(category, stat.files, stat.bytes);
        }
        for (const [extension, stat] of other.#extensions ?? []) {
            this.#addExtension(extension, stat.files, stat.bytes);
        }
        if (other.#largestFileBytes > this.#largestFileBytes) {
            this.#largestFileBytes = other.#largestFileBytes;
        }
        for (const ref of other.#topFiles?.sorted() ?? []) {
            if (this.#acceptsTop(ref.bytes)) this.#pushTop(move(ref));
        }
        if (other.#large) {
            const large = (this.#large ??= { refs: [], bytes: 0 });
            for (const ref of other.#large.refs) large.refs.push(move(ref));
            large.bytes += other.#large.bytes;
        }
        if (other.#empty) {
            const empty = (this.#empty ??= []);
            for (const ref of other.#empty) empty.push(move(ref));
        }
        if (other.#stale) {
            const stale = (this.#stale ??= { refs: [], bytes: 0 });
            for (const ref of other.#stale.refs) stale.refs.push(move(ref));
            stale.bytes += other.#stale.bytes;
        }
        const files = other.#treeFiles?.get(0);
        if (files) {
            const heap = new TopK<FileRef>(this.#features.tree!.limit, (a, b) =>
                comparePaths(a.name, b.name)
            );
            for (const ref of files.sorted()) heap.push(ref.bytes, move(ref));
            (this.#treeFiles ??= new Map()).set(dir, heap);
        }
        // Candidates are shared, not copied: watch merges every folder for each report, and a
        // candidate keeps its digests across reports. Only its directory index is updated.
        for (const candidate of other.candidates()) {
            candidate.dir = dir;
            this.#addCandidate(candidate);
        }
    }

    /** Every duplicate candidate collected so far. */
    *candidates(): Generator<Candidate> {
        for (const value of this.#bySize?.values() ?? []) {
            if (Array.isArray(value)) yield* value;
            else yield value;
        }
    }

    directory(index: number, node: DirNode): void {
        const tree = this.#features.tree;
        if (tree && node.parent >= 0 && node.depth <= tree.depth) {
            const children = (this.#treeChildren ??= new Map());
            let siblings = children.get(node.parent);
            if (!siblings) children.set(node.parent, (siblings = []));
            siblings.push(index);
        }
    }

    file(dir: number, name: string, stats: Stats): void {
        const bytes = stats.size;
        const mtimeMs = stats.mtimeMs;
        const features = this.#features;

        const extension = extensionOf(name);
        this.#addType(classify(name, extension), 1, bytes);
        this.#addExtension(extension, 1, bytes);
        if (bytes > this.#largestFileBytes) this.#largestFileBytes = bytes;

        let ref: FileRef | undefined;
        const makeRef = (): FileRef => (ref ??= { dir, name, bytes, mtimeMs });

        if (this.#acceptsTop(bytes)) this.#pushTop(makeRef());
        if (features.largeThreshold !== null && bytes >= features.largeThreshold) {
            const large = (this.#large ??= { refs: [], bytes: 0 });
            large.refs.push(makeRef());
            large.bytes += bytes;
        }
        if (features.empty && bytes === 0) (this.#empty ??= []).push(makeRef());
        if (features.staleBefore !== null && mtimeMs < features.staleBefore) {
            const stale = (this.#stale ??= { refs: [], bytes: 0 });
            stale.refs.push(makeRef());
            stale.bytes += bytes;
        }
        if (features.tree) {
            const depth = this.#scanner!.dirs[dir]!.depth;
            if (depth < features.tree.depth) {
                const heaps = (this.#treeFiles ??= new Map());
                let heap = heaps.get(dir);
                if (!heap) {
                    heap = new TopK<FileRef>(features.tree.limit, (a, b) =>
                        comparePaths(a.name, b.name)
                    );
                    heaps.set(dir, heap);
                }
                if (heap.accepts(bytes)) heap.push(bytes, makeRef());
            }
        }
        if (features.duplicates && bytes >= features.minDuplicateSize) {
            const candidate: Candidate = {
                dir,
                name,
                bytes,
                dev: stats.dev,
                ino: stats.ino,
                nlink: stats.nlink,
            };
            if (this.#stamps) {
                candidate.mtimeMs = mtimeMs;
                candidate.ctimeMs = stats.ctimeMs;
            }
            this.#addCandidate(candidate);
        }
    }

    #addCandidate(candidate: Candidate): void {
        const bySize = (this.#bySize ??= new Map());
        const existing = bySize.get(candidate.bytes);
        if (existing === undefined) bySize.set(candidate.bytes, candidate);
        else if (Array.isArray(existing)) existing.push(candidate);
        else bySize.set(candidate.bytes, [existing, candidate]);
    }

    async findDuplicates(
        scanner: ScanTree,
        concurrency: number,
        signal: AbortSignal | undefined,
        onProgress: (progress: DuplicateProgress) => void,
        cache?: DigestCache
    ): Promise<NonNullable<AnalysisResult['duplicates']>> {
        const groups: Candidate[][] = [];
        for (const value of this.#bySize?.values() ?? []) {
            if (Array.isArray(value)) groups.push(value);
        }
        this.#bySize = null;

        const dirPaths = new Map<number, string>();
        const hashed = await findDuplicates(groups, {
            pathOf: (c) => {
                let dir = dirPaths.get(c.dir);
                if (dir === undefined) dirPaths.set(c.dir, (dir = scanner.absolutePath(c.dir)));
                return joinRelative(dir, c.name);
            },
            concurrency,
            signal,
            onProgress,
            onError: (c, error) => scanner.recordError(scanner.relativePath(c.dir, c.name), error),
            cache,
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
        scanner: ScanTree,
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
            types: this.#typeStats(),
            extensions: [...(this.#extensions ?? [])]
                .map(([extension, stat]) => ({ extension, ...stat }))
                .sort(
                    (a, b) =>
                        b.bytes - a.bytes ||
                        b.files - a.files ||
                        comparePaths(a.extension, b.extension)
                ),
            largestDirectories: this.#largestDirectories(scanner),
            largestFiles: (this.#topFiles?.sorted() ?? []).map(toEntry),
            errors: [...scanner.errors].sort((a, b) => comparePaths(a.path, b.path)),
        };

        if (features.largeThreshold !== null) {
            const large = this.#large ?? { refs: [], bytes: 0 };
            result.largeFiles = {
                threshold: features.largeThreshold,
                count: large.refs.length,
                bytes: large.bytes,
                items: large.refs.map(toEntry).sort(bySizeThenPath),
            };
        }
        if (context.duplicates) result.duplicates = context.duplicates;
        if (features.empty) {
            const empty = this.#empty ?? [];
            result.emptyFiles = {
                count: empty.length,
                bytes: 0,
                items: empty.map(toEntry).sort((a, b) => comparePaths(a.path, b.path)),
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
            const stale = this.#stale ?? { refs: [], bytes: 0 };
            result.staleFiles = {
                modifiedBefore: new Date(features.staleBefore).toISOString(),
                count: stale.refs.length,
                bytes: stale.bytes,
                items: stale.refs.map(toEntry).sort(bySizeThenPath),
            };
        }
        if (features.tree) result.tree = this.#buildTree(scanner, 0, features.tree.limit, toEntry);
        return result;
    }

    /** Every file type, in the usual order, including those without files. */
    #typeStats(): Record<Category, SizeStat> {
        const types = emptyTypeStats();
        for (const category of CATEGORIES) {
            const stat = this.#types?.[category];
            if (stat) types[category] = { ...stat };
        }
        return types;
    }

    #largestDirectories(scanner: ScanTree): DirectoryEntry[] {
        const top = new TopK<number>(this.#features.top, (a, b) =>
            scanner.compareRelative(a, undefined, b, undefined)
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
        scanner: ScanTree,
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
        const subdirs = this.#treeChildren?.get(index);
        const files = this.#treeFiles?.get(index);
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
        candidates.sort((a, b) => b.bytes - a.bytes || comparePaths(a.key, b.key));
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

    /** Ties in the largest-files heap: path order, without building the paths (#31). */
    #compareRefs(a: FileRef, b: FileRef): number {
        return this.#scanner!.compareRelative(a.dir, a.name, b.dir, b.name);
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
