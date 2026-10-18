import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatError, errorCode, errorMessage } from '../errors.ts';
import { parseSize } from '../format/bytes.ts';
import { parsePointInTime } from '../format/time.ts';
import type { AnalysisSettings } from '../types.ts';
import { Excluder } from './exclude.ts';
import { Scanner, type ScanOptions } from './scanner.ts';

/** Default number of concurrent filesystem operations. */
export const DEFAULT_CONCURRENCY: number = 16;

/** Options shared by every operation that walks a directory tree. */
export interface ScanSettings {
    /** Gitignore-style patterns to skip, relative to the root (`*.log`, `build/`, `docs/**\/*.pdf`). */
    exclude?: readonly string[] | undefined;
    /** Skip `.git`, `.hg`, `.svn`, and `node_modules`. Default: `true`. */
    defaultExcludes?: boolean | undefined;
    /** Honor `.gitignore` files. Default: `false`. */
    gitignore?: boolean | undefined;
    /** Directory levels to descend below the root; `0` scans only the root's own files. Default: unlimited. */
    maxDepth?: number | null | undefined;
    /** Follow symbolic links (cycles are detected). Default: `false`. */
    followSymlinks?: boolean | undefined;
    /** Count each hard link separately instead of counting shared data once. Default: `false`. */
    countHardlinks?: boolean | undefined;
    /** Only include files at least this large: bytes or a size string such as `"10MB"`. */
    minSize?: number | string | undefined;
    /** Only include files at most this large. */
    maxSize?: number | string | undefined;
    /** Only include files modified at or after this time: a date, epoch ms, `YYYY-MM-DD`, or an age such as `"30d"`. */
    modifiedAfter?: Date | number | string | undefined;
    /** Only include files modified at or before this time. Date-only values include the whole day. */
    modifiedBefore?: Date | number | string | undefined;
    /** Maximum concurrent filesystem operations. Default: {@link DEFAULT_CONCURRENCY}. */
    concurrency?: number | undefined;
    /** Cancels the operation; the promise then rejects with an `AbortError`. */
    signal?: AbortSignal | undefined;
}

export interface ResolvedScan {
    options: ScanOptions;
    settings: AnalysisSettings;
}

/** Validates the root and turns user-facing settings into scanner options. */
export async function resolveScan(
    path: string,
    input: ScanSettings,
    now: number
): Promise<ResolvedScan> {
    const root = resolve(path);
    await assertDirectory(root);

    const maxDepth = input.maxDepth ?? null;
    if (maxDepth !== null && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
        throw new DatError(`maxDepth must be a non-negative integer (got ${maxDepth}).`);
    }
    const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new DatError(`concurrency must be a positive integer (got ${concurrency}).`);
    }

    const minSize = toBytes(input.minSize, 'minSize');
    const maxSize = toBytes(input.maxSize, 'maxSize');
    if (minSize !== null && maxSize !== null && minSize > maxSize) {
        throw new DatError(`minSize (${minSize}) is larger than maxSize (${maxSize}).`);
    }
    const after = toTimestamp(input.modifiedAfter, 'modifiedAfter', now, false);
    const before = toTimestamp(input.modifiedBefore, 'modifiedBefore', now, true);
    if (after !== null && before !== null && after > before) {
        throw new DatError('modifiedAfter is later than modifiedBefore, so no file could match.');
    }

    const exclude = [...(input.exclude ?? [])];
    const defaultExcludes = input.defaultExcludes ?? true;
    const gitignore = input.gitignore ?? false;
    const followSymlinks = input.followSymlinks ?? false;
    const countHardlinks = input.countHardlinks ?? false;

    return {
        options: {
            root,
            excluder: new Excluder({ patterns: exclude, defaultExcludes, gitignore }),
            maxDepth: maxDepth ?? Infinity,
            followSymlinks,
            countHardlinks,
            minSize: minSize ?? 0,
            maxSize: maxSize ?? Infinity,
            modifiedAfter: after ?? -Infinity,
            modifiedBefore: before ?? Infinity,
            concurrency,
            signal: input.signal,
        },
        settings: {
            exclude,
            defaultExcludes,
            gitignore,
            maxDepth,
            followSymlinks,
            countHardlinks,
            minSize,
            maxSize,
            modifiedAfter: after === null ? null : new Date(after).toISOString(),
            modifiedBefore: before === null ? null : new Date(before).toISOString(),
        },
    };
}

export async function assertDirectory(path: string): Promise<void> {
    const stats = await stat(path).catch((error: unknown) => {
        const code = errorCode(error);
        if (code === 'ENOENT') throw new DatError(`No such directory: ${path}`);
        if (code === 'EACCES' || code === 'EPERM') throw new DatError(`Permission denied: ${path}`);
        throw new DatError(`Cannot access ${path}: ${errorMessage(error)}`, { cause: error });
    });
    if (!stats.isDirectory()) throw new DatError(`Not a directory: ${path}`);
}

export function toBytes(value: number | string | undefined | null, name: string): number | null {
    if (value === undefined || value === null) return null;
    try {
        return parseSize(value);
    } catch (error) {
        throw new DatError(`${name}: ${errorMessage(error)}`);
    }
}

function toTimestamp(
    value: Date | number | string | undefined,
    name: string,
    now: number,
    endOfDay: boolean
): number | null {
    if (value === undefined) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    try {
        return parsePointInTime(value, { now, endOfDay });
    } catch (error) {
        throw new DatError(`${name}: ${errorMessage(error)}`);
    }
}

/**
 * Lists the directories a scan with these settings would enter, as
 * root-relative `/` paths (the root itself is `""`). Files are not examined.
 */
export async function listDirectories(
    path: string,
    settings: ScanSettings = {}
): Promise<string[]> {
    const { options } = await resolveScan(path, settings, Date.now());
    const scanner = new Scanner({ ...options, directoriesOnly: true }, { file() {} });
    await scanner.run();
    return scanner.dirs.map((_, index) => scanner.relativePath(index));
}
