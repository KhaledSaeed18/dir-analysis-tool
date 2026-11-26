import { lstat, readdir, stat } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import { basename, sep } from 'node:path';
import type { ScanError } from '../types.ts';
import { AbortError, errorCode, errorMessage } from '../errors.ts';
import type { Excluder, IgnoreChain } from './exclude.ts';
import { Limiter } from './limiter.ts';
import { joinRelative } from './paths.ts';

/** Maximum number of error details kept; the total is always counted. */
export const MAX_ERROR_DETAILS = 100;

const IS_WINDOWS = process.platform === 'win32';

export interface ScanOptions {
    /** Absolute, resolved path of the directory to scan. */
    root: string;
    excluder: Excluder;
    /** Directory levels to descend below the root. `Infinity` for no limit. */
    maxDepth: number;
    followSymlinks: boolean;
    /** Count every hard link separately instead of counting shared data once. */
    countHardlinks: boolean;
    minSize: number;
    maxSize: number;
    modifiedAfter: number;
    modifiedBefore: number;
    concurrency: number;
    /** Walk directories without examining files (used to set up watchers). */
    directoriesOnly?: boolean | undefined;
    signal?: AbortSignal | undefined;
    /**
     * Called for each entry the scan leaves out, after it has been counted.
     * Used by `explain`; ordinary scans leave it unset, and the hook is only
     * reached on paths that already skip an entry.
     */
    onSkip?: ((event: SkipEvent) => void) | undefined;
    /**
     * Starts at a folder inside a larger scan instead of at a scan root: the
     * folder's root-relative path, the ignore rules it inherits, and its depth.
     * `root` is then that folder's absolute path. With `shallow`, subfolders
     * are reported to {@link ScanVisitor.subfolder} instead of being entered.
     * Used by watch to re-read only what changed.
     */
    start?: { rel: string; chain: IgnoreChain; depth: number; shallow: boolean } | undefined;
    /**
     * Receives files with several hard links instead of counting the first
     * one seen, so the caller decides which link counts. Their sizes and
     * filters are then the caller's to apply (see {@link passesFilters}).
     */
    onLinkedFile?: ((dir: number, name: string, stats: Stats, key: string) => void) | undefined;
    /** Called with the directory each recorded error belongs to (also beyond the detail limit). */
    onError?: ((dir: number, error: ScanError) => void) | undefined;
}

/** An entry a scan left out. `dir` is the index of the directory holding it. */
export type SkipEvent =
    | { kind: 'excluded'; dir: number; name: string; isDirectory: boolean; chain: IgnoreChain }
    | { kind: 'filtered'; dir: number; name: string; stats: Stats }
    | { kind: 'depth'; dir: number; name: string; depth: number }
    | { kind: 'symlink'; dir: number; name: string }
    /** With followSymlinks: a link to nothing (`ENOENT`) or to itself (`ELOOP`). */
    | { kind: 'broken-symlink'; dir: number; name: string; code: string };

/**
 * Per-directory record. Directories are stored in discovery order, so every
 * child has a larger index than its parent: iterating in reverse visits
 * children before parents, which is how sizes are rolled up.
 */
export interface DirNode {
    name: string;
    parent: number;
    depth: number;
    /** Entries on disk, before exclusion. Zero means empty; -1 means it could not be read. */
    entries: number;
    ownFiles: number;
    ownBytes: number;
    ownDiskBytes: number;
    /** Totals for the whole subtree; filled by {@link rollUp}. */
    files: number;
    bytes: number;
    diskBytes: number;
    /** Size of the largest immediate subdirectory; filled by {@link rollUp}. */
    largestChild: number;
}

export interface ScanVisitor {
    /** A directory was accepted and will be scanned, with the ignore rules it inherits. */
    directory?(index: number, node: DirNode, chain: IgnoreChain): void;
    /** With a shallow start: a subfolder that would have been entered. */
    subfolder?(parent: number, name: string, chain: IgnoreChain): void;
    /** A file passed every exclusion and filter. Called at most once per file. */
    file(dirIndex: number, name: string, stats: Stats, diskBytes: number): void;
}

export interface ScanCounters {
    files: number;
    bytes: number;
    diskBytes: number;
    directories: number;
    symlinks: number;
    hardlinks: number;
    excluded: number;
    filtered: number;
    errors: number;
}

/**
 * Concurrent directory walker.
 *
 * Reads directories with `readdir({ withFileTypes })` so directory entries
 * never need a `stat`; regular files are `lstat`ed exactly once. All
 * filesystem calls go through one {@link Limiter}, so concurrency stays
 * bounded no matter how wide the tree is. Results are independent of
 * scheduling order: callers sort what they report.
 */
export class Scanner {
    readonly dirs: DirNode[] = [];
    readonly errors: ScanError[] = [];
    readonly counters: ScanCounters = {
        files: 0,
        bytes: 0,
        diskBytes: 0,
        directories: 0,
        symlinks: 0,
        hardlinks: 0,
        excluded: 0,
        filtered: 0,
        errors: 0,
    };

    readonly #options: ScanOptions;
    readonly #visitor: ScanVisitor;
    readonly #limiter: Limiter;
    readonly #filtersActive: boolean;
    /** `dev:ino` of files with several links (or of every file when following symlinks). */
    readonly #seenInodes = new Set<string>();
    /** `dev:ino` of entered directories, tracked only when following symlinks. */
    readonly #seenDirs = new Set<string>();

    constructor(options: ScanOptions, visitor: ScanVisitor) {
        this.#options = options;
        this.#visitor = visitor;
        this.#limiter = new Limiter(options.concurrency);
        this.#filtersActive =
            options.minSize > 0 ||
            options.maxSize < Infinity ||
            options.modifiedAfter > -Infinity ||
            options.modifiedBefore < Infinity;
    }

    async run(): Promise<void> {
        const { root, signal, excluder, start } = this.#options;
        if (signal?.aborted) throw new AbortError();
        let chain: IgnoreChain;
        if (start) {
            // A folder inside a scan: a failure to read it is recorded like any folder's.
            chain = start.chain;
        } else {
            const rootStats = await stat(root);
            if (this.#options.followSymlinks) this.#seenDirs.add(await inodeKey(rootStats, root));
            chain = await excluder.loadAncestorChain(root);
        }
        const index = this.#addDir(start ? basename(start.rel) : '', -1, start?.depth ?? 0, chain);
        const relRoot = start?.rel ?? '';
        const onAbort = (): void => this.#limiter.abort(new AbortError());
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            this.#limiter.run(() =>
                this.#scanDir(index, root, chain, this.#options.excluder.needsPaths ? relRoot : '')
            );
            await this.#limiter.idle();
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }
    }

    /**
     * Orders two entries as {@link comparePaths} orders their relative paths,
     * without building them. See {@link compareRelativePaths}.
     */
    compareRelative(
        dirA: number,
        nameA: string | undefined,
        dirB: number,
        nameB: string | undefined
    ): number {
        return compareRelativePaths(this.dirs, dirA, nameA, dirB, nameB);
    }

    /** Root-relative path of a directory (or of `name` inside it), with `/` separators. */
    relativePath(dirIndex: number, name?: string): string {
        return relativePathOf(this.dirs, dirIndex, name);
    }

    absolutePath(dirIndex: number, name?: string): string {
        return joinRelative(this.#options.root, this.relativePath(dirIndex, name));
    }

    #addDir(name: string, parent: number, depth: number, chain: IgnoreChain): number {
        const node: DirNode = {
            name,
            parent,
            depth,
            entries: 0,
            ownFiles: 0,
            ownBytes: 0,
            ownDiskBytes: 0,
            files: 0,
            bytes: 0,
            diskBytes: 0,
            largestChild: 0,
        };
        const index = this.dirs.push(node) - 1;
        this.counters.directories++;
        this.#visitor.directory?.(index, node, chain);
        return index;
    }

    /**
     * @param relDir Root-relative path of the directory when the excluder
     *   matches paths (passed down from the parent, so it is never rebuilt
     *   from the root), and `''` otherwise.
     */
    async #scanDir(
        index: number,
        absPath: string,
        inherited: IgnoreChain,
        relDir: string
    ): Promise<void> {
        const { excluder } = this.#options;
        let entries: Dirent[];
        try {
            entries = await readdir(absPath, { withFileTypes: true });
        } catch (error) {
            // -1 marks "could not be read", so it is never reported as an empty folder.
            this.dirs[index]!.entries = -1;
            this.recordError(this.relativePath(index), error, index);
            return;
        }
        const node = this.dirs[index]!;
        node.entries = entries.length;
        if (entries.length === 0) return;

        let chain = inherited;
        if (
            excluder.gitignore &&
            entries.some((e) => e.name === '.gitignore' && !e.isDirectory())
        ) {
            const scope = await excluder.loadScope(joinNative(absPath, '.gitignore'), relDir);
            if (scope) chain = [...inherited, scope];
        }

        const base = absPath.endsWith(sep) ? absPath : absPath + sep;
        const checkExclusion = excluder.active;
        const needsPaths = excluder.needsPaths;
        for (const entry of entries) {
            const name = entry.name;
            const isDirectory = entry.isDirectory();
            const isFile = !isDirectory && entry.isFile();
            const isSymlink = !isDirectory && !isFile && entry.isSymbolicLink();
            const isUnknown = !isDirectory && !isFile && !isSymlink && isUnknownType(entry);
            if (!isDirectory && !isFile && !isSymlink && !isUnknown) continue; // sockets, FIFOs, devices

            // Only path-matching rules need the full path; default excludes match names.
            const rel = needsPaths ? (relDir ? `${relDir}/${name}` : name) : '';
            if (checkExclusion) {
                // Symlinks and unknown types are checked as files; directories they
                // resolve to are re-checked once their type is known.
                if (excluder.isExcluded(rel || name, name, isDirectory, chain)) {
                    this.counters.excluded++;
                    this.#options.onSkip?.({
                        kind: 'excluded',
                        dir: index,
                        name,
                        isDirectory,
                        chain,
                    });
                    continue;
                }
            }

            const fullPath = base + name;
            if (this.#options.directoriesOnly && !isDirectory) continue;
            if (isDirectory && !this.#options.followSymlinks) {
                this.#enterDir(index, name, fullPath, chain, rel);
            } else if (isFile) {
                this.#limiter.run(() => this.#statFile(index, name, fullPath));
            } else {
                this.#limiter.run(() =>
                    this.#resolveEntry(index, name, fullPath, chain, rel, isSymlink, isDirectory)
                );
            }
        }
    }

    #enterDir(
        parent: number,
        name: string,
        fullPath: string,
        chain: IgnoreChain,
        relPath: string
    ): void {
        const depth = this.dirs[parent]!.depth + 1;
        if (depth > this.#options.maxDepth) {
            this.#options.onSkip?.({ kind: 'depth', dir: parent, name, depth });
            return;
        }
        if (this.#options.start?.shallow) {
            this.#visitor.subfolder?.(parent, name, chain);
            return;
        }
        const child = this.#addDir(name, parent, depth, chain);
        this.#limiter.run(() => this.#scanDir(child, fullPath, chain, relPath));
    }

    async #statFile(dirIndex: number, name: string, fullPath: string): Promise<void> {
        let stats: Stats;
        try {
            stats = await lstat(fullPath);
        } catch (error) {
            this.recordError(this.relativePath(dirIndex, name), error, dirIndex);
            return;
        }
        const pending = this.#acceptFile(dirIndex, name, fullPath, stats);
        if (pending) await pending;
    }

    /**
     * Handles symlinks, entries whose type the filesystem did not report, and
     * (when following symlinks) directories, which then need their identity.
     */
    async #resolveEntry(
        dirIndex: number,
        name: string,
        fullPath: string,
        chain: IgnoreChain,
        relPath: string,
        isSymlink: boolean,
        checkedAsDirectory: boolean
    ): Promise<void> {
        let stats: Stats;
        try {
            stats = await lstat(fullPath);
            if (stats.isSymbolicLink()) {
                isSymlink = true;
                if (!this.#options.followSymlinks) {
                    this.counters.symlinks++;
                    this.#options.onSkip?.({ kind: 'symlink', dir: dirIndex, name });
                    return;
                }
                stats = await stat(fullPath);
            }
        } catch (error) {
            const code = errorCode(error);
            // A dangling link is not an error, just a link to nothing; explain still lists it.
            if (isSymlink && (code === 'ENOENT' || code === 'ELOOP')) {
                this.counters.symlinks++;
                this.#options.onSkip?.({ kind: 'broken-symlink', dir: dirIndex, name, code });
                return;
            }
            this.recordError(this.relativePath(dirIndex, name), error, dirIndex);
            return;
        }

        if (isSymlink) this.counters.symlinks++;
        if (stats.isDirectory()) {
            const { excluder } = this.#options;
            if (excluder.active && !checkedAsDirectory) {
                if (excluder.isExcluded(relPath || name, name, true, chain)) {
                    this.counters.excluded++;
                    this.#options.onSkip?.({
                        kind: 'excluded',
                        dir: dirIndex,
                        name,
                        isDirectory: true,
                        chain,
                    });
                    return;
                }
            }
            // Only reached for every directory when following symlinks: enter each
            // directory once, however many paths lead to it (this also breaks cycles).
            const key = await inodeKey(stats, fullPath);
            if (this.#seenDirs.has(key)) return;
            this.#seenDirs.add(key);
            this.#enterDir(dirIndex, name, fullPath, chain, relPath);
        } else if (stats.isFile()) {
            const pending = this.#acceptFile(dirIndex, name, fullPath, stats);
            if (pending) await pending;
        }
    }

    /**
     * Counts a file once per underlying data. Synchronous unless the file's
     * identity needs an exact (bigint) stat; see `inodeKey`.
     */
    #acceptFile(
        dirIndex: number,
        name: string,
        fullPath: string,
        stats: Stats
    ): Promise<void> | undefined {
        const onLinked = this.#options.onLinkedFile;
        if (onLinked && !this.#options.countHardlinks && stats.nlink > 1) {
            const key = inodeKey(stats, fullPath);
            if (typeof key !== 'string') {
                return key.then((exact) => onLinked(dirIndex, name, stats, exact));
            }
            onLinked(dirIndex, name, stats, key);
            return undefined;
        }
        if (!this.#options.countHardlinks && (stats.nlink > 1 || this.#options.followSymlinks)) {
            const key = inodeKey(stats, fullPath);
            if (typeof key !== 'string') {
                return key.then((exact) => this.#acceptKeyedFile(dirIndex, name, stats, exact));
            }
            this.#acceptKeyedFile(dirIndex, name, stats, key);
            return undefined;
        }
        this.#countFile(dirIndex, name, stats);
        return undefined;
    }

    #acceptKeyedFile(dirIndex: number, name: string, stats: Stats, key: string): void {
        if (this.#seenInodes.has(key)) {
            // Reached again through another hard link, or through a followed symlink.
            if (stats.nlink > 1) this.counters.hardlinks++;
            return;
        }
        this.#seenInodes.add(key);
        this.#countFile(dirIndex, name, stats);
    }

    #countFile(dirIndex: number, name: string, stats: Stats): void {
        const size = stats.size;
        if (this.#filtersActive && !passesFilters(this.#options, stats)) {
            this.counters.filtered++;
            this.#options.onSkip?.({ kind: 'filtered', dir: dirIndex, name, stats });
            return;
        }

        const diskBytes = diskBytesOf(stats);
        const node = this.dirs[dirIndex]!;
        node.ownFiles++;
        node.ownBytes += size;
        node.ownDiskBytes += diskBytes;
        this.counters.files++;
        this.counters.bytes += size;
        this.counters.diskBytes += diskBytes;
        this.#visitor.file(dirIndex, name, stats, diskBytes);
    }

    /** Counts an error and keeps its details, up to {@link MAX_ERROR_DETAILS}. */
    recordError(path: string, error: unknown, dir = -1): void {
        this.counters.errors++;
        const detail = scanError(path, error);
        if (dir >= 0) this.#options.onError?.(dir, detail);
        if (this.errors.length < MAX_ERROR_DETAILS) this.errors.push(detail);
    }
}

/**
 * Rolls per-directory totals up the tree. Must run once, after the scan.
 * Relies on children always having larger indices than their parents.
 */
export function rollUp(dirs: DirNode[]): void {
    for (let i = dirs.length - 1; i >= 0; i--) {
        const node = dirs[i]!;
        node.files += node.ownFiles;
        node.bytes += node.ownBytes;
        node.diskBytes += node.ownDiskBytes;
        if (node.parent >= 0) {
            const parent = dirs[node.parent]!;
            parent.files += node.files;
            parent.bytes += node.bytes;
            parent.diskBytes += node.diskBytes;
            if (node.bytes > parent.largestChild) parent.largestChild = node.bytes;
        }
    }
}

/** Root-relative path of a directory (or of `name` inside it) in `dirs`, with `/` separators. */
export function relativePathOf(
    dirs: readonly Pick<DirNode, 'name' | 'parent'>[],
    dirIndex: number,
    name?: string
): string {
    const parts: string[] = name === undefined ? [] : [name];
    for (let i = dirIndex; i > 0; i = dirs[i]!.parent) parts.push(dirs[i]!.name);
    return parts.toReversed().join('/');
}

/** Whether a file passes the size and date filters. */
export function passesFilters(
    options: Pick<ScanOptions, 'minSize' | 'maxSize' | 'modifiedAfter' | 'modifiedBefore'>,
    stats: Stats
): boolean {
    const size = stats.size;
    const mtime = stats.mtimeMs;
    return !(
        size < options.minSize ||
        size > options.maxSize ||
        mtime < options.modifiedAfter ||
        mtime > options.modifiedBefore
    );
}

/** Space a file takes on disk, which `du` reports; its length where blocks aren't known. */
export function diskBytesOf(stats: Stats): number {
    return IS_WINDOWS || !(stats.blocks >= 0) ? stats.size : stats.blocks * 512;
}

/** An error's details as reports show them. */
export function scanError(path: string, error: unknown): ScanError {
    const code = errorCode(error);
    return {
        path: path || '.',
        code: code ?? 'UNKNOWN',
        message: (code && ERROR_DESCRIPTIONS[code]) ?? errorMessage(error),
    };
}

/** Code unit of the `/` that joins path segments. */
const SLASH = 0x2f;

/**
 * Compares the root-relative paths of two entries, each a directory index
 * plus an optional name inside it. The result has the same sign as
 * `comparePaths(relativePath(dirA, nameA), relativePath(dirB, nameB))`.
 *
 * Building both paths costs O(depth) time and garbage on every call, which
 * made top-N tie-breaks on deep trees slow (#31). This walks parent indices
 * to the closest common directory instead, and compares only the first
 * segment where the paths part. That is not a segment-by-segment comparison:
 * when one segment is a prefix of the other, the shorter path continues with
 * `/` (or ends), and `/` sorts after characters such as `-` and `.`, exactly
 * as it does in the joined string.
 */
export function compareRelativePaths(
    dirs: readonly Pick<DirNode, 'name' | 'parent' | 'depth'>[],
    dirA: number,
    nameA: string | undefined,
    dirB: number,
    nameB: string | undefined
): number {
    if (dirA === dirB) {
        if (nameA === undefined || nameB === undefined) {
            // The directory itself is a prefix of every path inside it.
            return nameA === nameB ? 0 : nameA === undefined ? -1 : 1;
        }
        return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    }
    // Walk up to the closest common directory, remembering the directory just
    // below it on each side (-1 when that side is the common directory).
    let a = dirA;
    let b = dirB;
    let belowA = -1;
    let belowB = -1;
    while (dirs[a]!.depth > dirs[b]!.depth) {
        belowA = a;
        a = dirs[a]!.parent;
    }
    while (dirs[b]!.depth > dirs[a]!.depth) {
        belowB = b;
        b = dirs[b]!.parent;
    }
    while (a !== b) {
        belowA = a;
        a = dirs[a]!.parent;
        belowB = b;
        b = dirs[b]!.parent;
    }
    // Both paths share everything up to the common directory and its `/`; they
    // part at the next segment, which is a directory below it or the entry name.
    const segmentA = belowA === -1 ? nameA : dirs[belowA]!.name;
    const segmentB = belowB === -1 ? nameB : dirs[belowB]!.name;
    if (segmentA === undefined) return segmentB === undefined ? 0 : -1;
    if (segmentB === undefined) return 1;
    const length = Math.min(segmentA.length, segmentB.length);
    for (let i = 0; i < length; i++) {
        const diff = segmentA.charCodeAt(i) - segmentB.charCodeAt(i);
        if (diff !== 0) return diff;
    }
    // One segment is a prefix of the other: compare what follows it, a `/` when
    // the path goes on and nothing (lowest of all) when it ends.
    const nextA = nextCode(
        segmentA,
        length,
        belowA !== -1 && (belowA !== dirA || nameA !== undefined)
    );
    const nextB = nextCode(
        segmentB,
        length,
        belowB !== -1 && (belowB !== dirB || nameB !== undefined)
    );
    return nextA - nextB;
}

function nextCode(segment: string, at: number, continues: boolean): number {
    if (at < segment.length) return segment.charCodeAt(at);
    return continues ? SLASH : -1;
}

/**
 * `dev:ino` identity of a file or directory. `Stats.ino` is a Number, which is
 * exact only up to 2^53; Windows NTFS file IDs keep a sequence number in their
 * top 16 bits and often exceed that, so neighboring files can round to the
 * same value. Those few get an exact bigint stat instead. Keys are only taken
 * for files and directories (a followed symlink is keyed by its target), so
 * the stat follows links.
 */
export function inodeKey(stats: Stats, path: string): string | Promise<string> {
    if (Number.isSafeInteger(stats.ino)) return `${stats.dev}:${stats.ino}`;
    return exactInodeKey(path);
}

/** `dev:ino` from a bigint stat, exact for any 64-bit file ID. */
export async function exactInodeKey(path: string): Promise<string> {
    const exact = await stat(path, { bigint: true });
    return `${exact.dev}:${exact.ino}`;
}

function joinNative(dir: string, name: string): string {
    return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

function isUnknownType(entry: Dirent): boolean {
    return !(
        entry.isBlockDevice() ||
        entry.isCharacterDevice() ||
        entry.isFIFO() ||
        entry.isSocket()
    );
}

const ERROR_DESCRIPTIONS: Record<string, string> = {
    EACCES: 'permission denied',
    EPERM: 'operation not permitted',
    ENOENT: 'no longer exists',
    ELOOP: 'too many levels of symbolic links',
    EMFILE: 'too many open files',
    ENAMETOOLONG: 'name too long',
    EIO: 'input/output error',
    EBUSY: 'resource busy',
};
