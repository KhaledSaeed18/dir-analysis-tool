import { lstat, readdir, stat } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import { sep } from 'node:path';
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
}

/**
 * Per-directory record. Directories are stored in discovery order, so every
 * child has a larger index than its parent: iterating in reverse visits
 * children before parents, which is how sizes are rolled up.
 */
export interface DirNode {
    name: string;
    parent: number;
    depth: number;
    /** Entries on disk, before exclusion. Zero means the directory is empty. */
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
    /** A directory was accepted and will be scanned. */
    directory?(index: number, node: DirNode): void;
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
        const { root, signal, excluder } = this.#options;
        if (signal?.aborted) throw new AbortError();
        const rootStats = await stat(root);
        if (this.#options.followSymlinks) this.#seenDirs.add(inodeKey(rootStats));

        const chain = await excluder.loadAncestorChain(root);
        const index = this.#addDir('', -1, 0);
        const onAbort = (): void => this.#limiter.abort(new AbortError());
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            this.#limiter.run(() => this.#scanDir(index, root, chain));
            await this.#limiter.idle();
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }
    }

    /** Root-relative path of a directory (or of `name` inside it), with `/` separators. */
    relativePath(dirIndex: number, name?: string): string {
        const parts: string[] = name === undefined ? [] : [name];
        for (let i = dirIndex; i > 0; i = this.dirs[i]!.parent) parts.push(this.dirs[i]!.name);
        return parts.toReversed().join('/');
    }

    absolutePath(dirIndex: number, name?: string): string {
        return joinRelative(this.#options.root, this.relativePath(dirIndex, name));
    }

    #addDir(name: string, parent: number, depth: number): number {
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
        this.#visitor.directory?.(index, node);
        return index;
    }

    async #scanDir(index: number, absPath: string, inherited: IgnoreChain): Promise<void> {
        const { excluder } = this.#options;
        let entries: Dirent[];
        try {
            entries = await readdir(absPath, { withFileTypes: true });
        } catch (error) {
            this.recordError(this.relativePath(index), error);
            return;
        }
        const node = this.dirs[index]!;
        node.entries = entries.length;
        if (entries.length === 0) return;

        const relDir = excluder.needsPaths ? this.relativePath(index) : '';
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
        for (const entry of entries) {
            const name = entry.name;
            const isDirectory = entry.isDirectory();
            const isFile = !isDirectory && entry.isFile();
            const isSymlink = !isDirectory && !isFile && entry.isSymbolicLink();
            const isUnknown = !isDirectory && !isFile && !isSymlink && isUnknownType(entry);
            if (!isDirectory && !isFile && !isSymlink && !isUnknown) continue; // sockets, FIFOs, devices

            if (checkExclusion) {
                const rel = relDir ? `${relDir}/${name}` : name;
                // Symlinks and unknown types are checked as files; directories they
                // resolve to are re-checked once their type is known.
                if (excluder.isExcluded(rel, name, isDirectory, chain)) {
                    this.counters.excluded++;
                    continue;
                }
            }

            const fullPath = base + name;
            if (this.#options.directoriesOnly && !isDirectory) continue;
            if (isDirectory && !this.#options.followSymlinks) {
                this.#enterDir(index, name, fullPath, chain);
            } else if (isFile) {
                this.#limiter.run(() => this.#statFile(index, name, fullPath));
            } else {
                this.#limiter.run(() =>
                    this.#resolveEntry(index, name, fullPath, chain, isSymlink, isDirectory)
                );
            }
        }
    }

    #enterDir(parent: number, name: string, fullPath: string, chain: IgnoreChain): void {
        const depth = this.dirs[parent]!.depth + 1;
        if (depth > this.#options.maxDepth) return;
        const child = this.#addDir(name, parent, depth);
        this.#limiter.run(() => this.#scanDir(child, fullPath, chain));
    }

    async #statFile(dirIndex: number, name: string, fullPath: string): Promise<void> {
        let stats: Stats;
        try {
            stats = await lstat(fullPath);
        } catch (error) {
            this.recordError(this.relativePath(dirIndex, name), error);
            return;
        }
        this.#acceptFile(dirIndex, name, stats);
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
                    return;
                }
                stats = await stat(fullPath);
            }
        } catch (error) {
            const code = errorCode(error);
            // A dangling link is not an error, just a link to nothing.
            if (isSymlink && (code === 'ENOENT' || code === 'ELOOP')) {
                this.counters.symlinks++;
                return;
            }
            this.recordError(this.relativePath(dirIndex, name), error);
            return;
        }

        if (isSymlink) this.counters.symlinks++;
        if (stats.isDirectory()) {
            const { excluder } = this.#options;
            if (excluder.active && !checkedAsDirectory) {
                const rel = this.relativePath(dirIndex, name);
                if (excluder.isExcluded(rel, name, true, chain)) {
                    this.counters.excluded++;
                    return;
                }
            }
            // Only reached for every directory when following symlinks: enter each
            // directory once, however many paths lead to it (this also breaks cycles).
            const key = inodeKey(stats);
            if (this.#seenDirs.has(key)) return;
            this.#seenDirs.add(key);
            this.#enterDir(dirIndex, name, fullPath, chain);
        } else if (stats.isFile()) {
            this.#acceptFile(dirIndex, name, stats);
        }
    }

    #acceptFile(dirIndex: number, name: string, stats: Stats): void {
        if (!this.#options.countHardlinks && (stats.nlink > 1 || this.#options.followSymlinks)) {
            const key = inodeKey(stats);
            if (this.#seenInodes.has(key)) {
                // Reached again through another hard link, or through a followed symlink.
                if (stats.nlink > 1) this.counters.hardlinks++;
                return;
            }
            this.#seenInodes.add(key);
        }

        const size = stats.size;
        if (this.#filtersActive) {
            const o = this.#options;
            const mtime = stats.mtimeMs;
            if (
                size < o.minSize ||
                size > o.maxSize ||
                mtime < o.modifiedAfter ||
                mtime > o.modifiedBefore
            ) {
                this.counters.filtered++;
                return;
            }
        }

        const diskBytes = IS_WINDOWS || !(stats.blocks >= 0) ? size : stats.blocks * 512;
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
    recordError(path: string, error: unknown): void {
        this.counters.errors++;
        if (this.errors.length >= MAX_ERROR_DETAILS) return;
        const code = errorCode(error);
        this.errors.push({
            path: path || '.',
            code: code ?? 'UNKNOWN',
            message: (code && ERROR_DESCRIPTIONS[code]) ?? errorMessage(error),
        });
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

function inodeKey(stats: Stats): string {
    return `${stats.dev}:${stats.ino}`;
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
