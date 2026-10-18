import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Limiter } from './limiter.ts';
import { AbortError } from '../errors.ts';

/** Files up to this size are hashed in full straight away. */
const SAMPLE_THRESHOLD = 256 * 1024;
/** Bytes read from each end of a larger file for its sample hash. */
const SAMPLE_BYTES = 64 * 1024;
const READ_BUFFER_BYTES = 1024 * 1024;

export interface DuplicateCandidate {
    dir: number;
    name: string;
    bytes: number;
    /** Identity of the underlying data, so hard links are never reported as copies. */
    inode: string;
}

export interface HashedGroup<T extends DuplicateCandidate> {
    hash: string;
    bytes: number;
    members: T[];
}

export interface DuplicateProgress {
    stage: 'sample' | 'full';
    done: number;
    total: number;
}

export interface FindDuplicatesOptions<T extends DuplicateCandidate> {
    /** Absolute path of a candidate. */
    pathOf: (candidate: T) => string;
    concurrency: number;
    signal?: AbortSignal | undefined;
    onProgress?: ((progress: DuplicateProgress) => void) | undefined;
    /** Called for files that could not be read (deleted or locked mid-run). */
    onError?: ((candidate: T, error: unknown) => void) | undefined;
}

/**
 * Finds files with identical contents among groups of same-sized files.
 *
 * Work is staged so most files are never read in full:
 * 1. Only sizes shared by at least two distinct inodes are considered.
 * 2. Large files are first compared by a sample hash of their first and
 *    last 64 KiB, which separates almost all non-duplicates cheaply.
 * 3. Survivors (and small files) get a full streaming SHA-256.
 */
export async function findDuplicates<T extends DuplicateCandidate>(
    sizeGroups: Iterable<T[]>,
    options: FindDuplicatesOptions<T>
): Promise<Array<HashedGroup<T>>> {
    const small: T[][] = [];
    const large: T[][] = [];
    for (const group of sizeGroups) {
        const distinct = distinctInodes(group);
        if (distinct.length < 2) continue;
        (distinct[0]!.bytes <= SAMPLE_THRESHOLD ? small : large).push(distinct);
    }

    const buffers = new BufferPool(options.concurrency);
    const sampled = await hashStage(large, 'sample', options, buffers);
    const results = await hashStage(
        [...small, ...sampled.map((g) => g.members)],
        'full',
        options,
        buffers
    );
    return results;
}

async function hashStage<T extends DuplicateCandidate>(
    groups: T[][],
    stage: DuplicateProgress['stage'],
    options: FindDuplicatesOptions<T>,
    buffers: BufferPool
): Promise<Array<HashedGroup<T>>> {
    const total = groups.reduce((sum, g) => sum + g.length, 0);
    if (total === 0) return [];

    const byKey = new Map<string, HashedGroup<T>>();
    const limiter = new Limiter(options.concurrency);
    const { signal } = options;
    const onAbort = (): void => limiter.abort(new AbortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    let done = 0;
    options.onProgress?.({ stage, done, total });

    for (const group of groups) {
        for (const candidate of group) {
            limiter.run(async () => {
                const buffer = buffers.acquire();
                try {
                    const path = options.pathOf(candidate);
                    const hash =
                        stage === 'sample'
                            ? await sampleHash(path, candidate.bytes, buffer)
                            : await hashFile(path, buffer);
                    const key = `${candidate.bytes}:${hash}`;
                    let entry = byKey.get(key);
                    if (!entry) {
                        entry = { hash, bytes: candidate.bytes, members: [] };
                        byKey.set(key, entry);
                    }
                    entry.members.push(candidate);
                } catch (error) {
                    options.onError?.(candidate, error);
                } finally {
                    buffers.release(buffer);
                    done++;
                    options.onProgress?.({ stage, done, total });
                }
            });
        }
    }

    try {
        await limiter.idle();
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
    return [...byKey.values()].filter((g) => g.members.length > 1);
}

/** Streams a file through SHA-256 and returns the hex digest. */
export async function hashFile(
    path: string,
    buffer: Buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES)
): Promise<string> {
    const hash = createHash('sha256');
    const handle = await open(path, 'r');
    try {
        let position = 0;
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            if (bytesRead === 0) break;
            hash.update(buffer.subarray(0, bytesRead));
            position += bytesRead;
        }
    } finally {
        await handle.close();
    }
    return hash.digest('hex');
}

async function sampleHash(path: string, size: number, buffer: Buffer): Promise<string> {
    const hash = createHash('sha256');
    const handle = await open(path, 'r');
    try {
        for (const position of [0, Math.max(0, size - SAMPLE_BYTES)]) {
            const { bytesRead } = await handle.read(buffer, 0, SAMPLE_BYTES, position);
            hash.update(buffer.subarray(0, bytesRead));
        }
    } finally {
        await handle.close();
    }
    return hash.digest('hex');
}

function distinctInodes<T extends DuplicateCandidate>(group: T[]): T[] {
    if (group.length < 2) return group;
    const seen = new Set<string>();
    return group.filter((candidate) => {
        if (seen.has(candidate.inode)) return false;
        seen.add(candidate.inode);
        return true;
    });
}

/** Reuses read buffers so hashing allocates a fixed amount of memory. */
class BufferPool {
    readonly #free: Buffer[] = [];

    constructor(size: number) {
        for (let i = 0; i < size; i++) this.#free.push(Buffer.allocUnsafe(READ_BUFFER_BYTES));
    }

    acquire(): Buffer {
        return this.#free.pop() ?? Buffer.allocUnsafe(READ_BUFFER_BYTES);
    }

    release(buffer: Buffer): void {
        this.#free.push(buffer);
    }
}
