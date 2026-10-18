import type { Stats } from 'node:fs';
import { TOOL } from '../version.ts';
import {
    type Category,
    type ChangedFile,
    type ComparisonResult,
    type ComparisonSide,
    type DirectoryDelta,
    type FileEntry,
    type ItemList,
    type SizeStat,
} from '../types.ts';
import { createProgressReporter } from './analyze.ts';
import { comparePaths, joinRelative } from './paths.ts';
import { classify, emptyTypeStats } from './classify.ts';
import { hashFile } from './duplicates.ts';
import { Limiter } from './limiter.ts';
import { resolveScan, type ScanSettings } from './options.ts';
import { AbortError, DatError } from '../errors.ts';
import { rollUp, Scanner, type DirNode, type ScanVisitor } from './scanner.ts';

const PASS_THROUGH_SHARE = 0.95;

export interface CompareOptions extends ScanSettings {
    /** Also compare the contents of same-sized files (SHA-256). Default: `false`, size only. */
    content?: boolean | undefined;
    /** Length of the directory delta list. Default: 10. */
    top?: number | undefined;
    /** Called periodically with the number of files scanned so far. */
    onProgress?:
        ((progress: { phase: 'scan' | 'hash'; files: number; total?: number }) => void) | undefined;
    progressInterval?: number | undefined;
}

interface FileRecord {
    bytes: number;
    mtimeMs: number;
}

/** Records every file by its root-relative path, for diffing. */
class FileIndex implements ScanVisitor {
    readonly files = new Map<string, FileRecord>();
    readonly types: Record<Category, SizeStat> = emptyTypeStats();
    readonly #dirPaths: string[] = [];

    directory(index: number, node: DirNode): void {
        const parentPath = node.parent >= 0 ? this.#dirPaths[node.parent]! : '';
        this.#dirPaths[index] = parentPath ? `${parentPath}/${node.name}` : node.name;
    }

    file(dir: number, name: string, stats: Stats): void {
        const dirPath = this.#dirPaths[dir]!;
        this.files.set(dirPath ? `${dirPath}/${name}` : name, {
            bytes: stats.size,
            mtimeMs: stats.mtimeMs,
        });
        const type = this.types[classify(name)];
        type.files++;
        type.bytes += stats.size;
    }

    dirPath(index: number): string {
        return this.#dirPaths[index]!;
    }
}

/**
 * Compares two directory trees: what was added, removed, or changed, and
 * which folders grew or shrank the most. Both sides use the same exclusion
 * rules and filters. Memory grows with the number of files in both trees.
 */
export async function compare(
    left: string,
    right: string,
    options: CompareOptions = {}
): Promise<ComparisonResult> {
    const startedAt = Date.now();
    const started = performance.now();
    const top = options.top ?? 10;
    if (!Number.isInteger(top) || top < 0) {
        throw new DatError(`top must be a non-negative integer (got ${top}).`);
    }
    const [a, b] = await Promise.all([
        resolveScan(left, options, startedAt),
        resolveScan(right, options, startedAt),
    ]);

    const leftIndex = new FileIndex();
    const rightIndex = new FileIndex();
    const leftScanner = new Scanner(a.options, leftIndex);
    const rightScanner = new Scanner(b.options, rightIndex);
    const progress = createProgressReporter(options.onProgress, options.progressInterval, () => ({
        phase: 'scan' as const,
        files: leftScanner.counters.files + rightScanner.counters.files,
    }));
    try {
        await Promise.all([leftScanner.run(), rightScanner.run()]);
    } finally {
        progress.stop();
    }
    rollUp(leftScanner.dirs);
    rollUp(rightScanner.dirs);

    const added: FileEntry[] = [];
    const removed: FileEntry[] = [];
    const changed: ChangedFile[] = [];
    const sameSize: string[] = [];
    let unchanged = 0;

    for (const [path, l] of leftIndex.files) {
        const r = rightIndex.files.get(path);
        if (!r) removed.push(toEntry(path, l));
        else if (l.bytes !== r.bytes) {
            changed.push({
                path,
                leftBytes: l.bytes,
                rightBytes: r.bytes,
                delta: r.bytes - l.bytes,
            });
        } else if (options.content && l.bytes > 0) sameSize.push(path);
        else unchanged++;
    }
    for (const [path, r] of rightIndex.files) {
        if (!leftIndex.files.has(path)) added.push(toEntry(path, r));
    }

    if (sameSize.length > 0) {
        const differing = await findContentChanges(
            sameSize,
            a.options.root,
            b.options.root,
            options
        );
        for (const path of sameSize) {
            if (differing.has(path)) {
                const bytes = leftIndex.files.get(path)!.bytes;
                changed.push({ path, leftBytes: bytes, rightBytes: bytes, delta: 0 });
            } else {
                unchanged++;
            }
        }
    }

    const bySize = (x: FileEntry, y: FileEntry): number =>
        y.bytes - x.bytes || comparePaths(x.path, y.path);
    added.sort(bySize);
    removed.sort(bySize);
    changed.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || comparePaths(x.path, y.path));

    const leftSide = side(a.options.root, leftScanner, leftIndex);
    const rightSide = side(b.options.root, rightScanner, rightIndex);

    return {
        schemaVersion: 3,
        tool: TOOL,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Math.round(performance.now() - started),
        mode: options.content ? 'content' : 'size',
        left: leftSide,
        right: rightSide,
        delta: {
            bytes: rightSide.summary.bytes - leftSide.summary.bytes,
            diskBytes: rightSide.summary.diskBytes - leftSide.summary.diskBytes,
            files: rightSide.summary.files - leftSide.summary.files,
            directories: rightSide.summary.directories - leftSide.summary.directories,
        },
        added: list(added),
        removed: list(removed),
        changed: {
            count: changed.length,
            delta: changed.reduce((sum, c) => sum + c.delta, 0),
            items: changed,
        },
        unchanged,
        directories: directoryDeltas(leftScanner, leftIndex, rightScanner, rightIndex, top),
    };
}

function toEntry(path: string, record: FileRecord): FileEntry {
    return { path, bytes: record.bytes, modified: new Date(record.mtimeMs).toISOString() };
}

function list(items: FileEntry[]): ItemList<FileEntry> {
    return { count: items.length, bytes: items.reduce((sum, f) => sum + f.bytes, 0), items };
}

function side(root: string, scanner: Scanner, index: FileIndex): ComparisonSide {
    const c = scanner.counters;
    let largest = 0;
    for (const record of index.files.values()) if (record.bytes > largest) largest = record.bytes;
    return {
        root,
        summary: {
            bytes: c.bytes,
            diskBytes: c.diskBytes,
            files: c.files,
            directories: c.directories - 1,
            largestFileBytes: largest,
            symlinks: c.symlinks,
            hardlinks: c.hardlinks,
            excluded: c.excluded,
            filtered: c.filtered,
            errors: c.errors,
        },
        types: index.types,
    };
}

async function findContentChanges(
    paths: string[],
    leftRoot: string,
    rightRoot: string,
    options: CompareOptions
): Promise<Set<string>> {
    const differing = new Set<string>();
    const limiter = new Limiter(Math.min(options.concurrency ?? 8, 8));
    const onAbort = (): void => limiter.abort(new AbortError());
    options.signal?.addEventListener('abort', onAbort, { once: true });
    let done = 0;
    for (const path of paths) {
        limiter.run(async () => {
            try {
                const [l, r] = await Promise.all([
                    hashFile(joinRelative(leftRoot, path)),
                    hashFile(joinRelative(rightRoot, path)),
                ]);
                if (l !== r) differing.add(path);
            } catch {
                differing.add(path); // unreadable on one side: report it rather than hide it
            } finally {
                done++;
                options.onProgress?.({ phase: 'hash', files: done, total: paths.length });
            }
        });
    }
    try {
        await limiter.idle();
    } finally {
        options.signal?.removeEventListener('abort', onAbort);
    }
    return differing;
}

function directoryDeltas(
    leftScanner: Scanner,
    leftIndex: FileIndex,
    rightScanner: Scanner,
    rightIndex: FileIndex,
    top: number
): DirectoryDelta[] {
    if (top === 0) return [];
    const sizes = new Map<string, { left: number; right: number }>();
    const collect = (scanner: Scanner, index: FileIndex, key: 'left' | 'right'): void => {
        for (let i = 1; i < scanner.dirs.length; i++) {
            const path = index.dirPath(i);
            const entry = sizes.get(path) ?? { left: 0, right: 0 };
            entry[key] = scanner.dirs[i]!.bytes;
            sizes.set(path, entry);
        }
    };
    collect(leftScanner, leftIndex, 'left');
    collect(rightScanner, rightIndex, 'right');

    // For each directory, the child whose change is largest; used to fold pass-through folders.
    const largestChildDelta = new Map<string, number>();
    for (const [path, { left, right }] of sizes) {
        const slash = path.lastIndexOf('/');
        if (slash < 0) continue;
        const parent = path.slice(0, slash);
        const delta = right - left;
        const current = largestChildDelta.get(parent) ?? 0;
        if (Math.abs(delta) > Math.abs(current)) largestChildDelta.set(parent, delta);
    }

    const deltas: DirectoryDelta[] = [];
    for (const [path, { left, right }] of sizes) {
        const delta = right - left;
        if (delta === 0) continue;
        const child = largestChildDelta.get(path) ?? 0;
        if (
            Math.sign(child) === Math.sign(delta) &&
            Math.abs(child) >= Math.abs(delta) * PASS_THROUGH_SHARE
        ) {
            continue;
        }
        deltas.push({ path, leftBytes: left, rightBytes: right, delta });
    }
    deltas.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || comparePaths(x.path, y.path));
    return deltas.slice(0, top);
}
