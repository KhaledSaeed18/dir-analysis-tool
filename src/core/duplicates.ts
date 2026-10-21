import { createHash, hash } from 'node:crypto';
import { readFile } from 'node:fs';
import { open } from 'node:fs/promises';
import { AbortError } from '../errors.ts';

/** Files up to this size are read in one call and hashed in full straight away. */
const SAMPLE_THRESHOLD = 256 * 1024;
/** Bytes read from each end of a larger file for its sample hash. */
const SAMPLE_BYTES = 64 * 1024;
const READ_BUFFER_BYTES = 512 * 1024;
const ALGORITHM = 'sha256';

export interface DuplicateCandidate {
    dir: number;
    name: string;
    bytes: number;
    /** Identity of the underlying data, so hard links are never reported as copies. */
    dev: number;
    ino: number;
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
 * 3. Survivors (and small files) get a full SHA-256.
 *
 * Groups are hashed independently and finished as soon as their last member
 * is done, so memory holds only the groups in flight plus the results.
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

    const buffers = new BufferPool();
    const sampled = await hashStage(large, 'sample', options, buffers);
    for (const group of sampled) small.push(group.members);
    return hashStage(small, 'full', options, buffers);
}

interface GroupState<T extends DuplicateCandidate> {
    bytes: number;
    pending: number;
    byHash: Map<string, T[]>;
}

async function hashStage<T extends DuplicateCandidate>(
    groups: T[][],
    stage: DuplicateProgress['stage'],
    options: FindDuplicatesOptions<T>,
    buffers: BufferPool
): Promise<Array<HashedGroup<T>>> {
    let total = 0;
    for (const group of groups) total += group.length;
    const results: Array<HashedGroup<T>> = [];
    if (total === 0) return results;

    const { signal, onProgress } = options;
    let done = 0;
    onProgress?.({ stage, done, total });

    const finish = (state: GroupState<T>): void => {
        for (const [digest, members] of state.byHash) {
            if (members.length > 1) results.push({ hash: digest, bytes: state.bytes, members });
        }
    };

    function* tasks(): Generator<() => Promise<void>> {
        for (const group of groups) {
            const state: GroupState<T> = {
                bytes: group[0]!.bytes,
                pending: group.length,
                byHash: new Map(),
            };
            for (const candidate of group) {
                yield async () => {
                    try {
                        const path = options.pathOf(candidate);
                        const digest =
                            stage === 'sample'
                                ? await sampleHash(path, candidate.bytes, buffers)
                                : await hashFileOfSize(path, candidate.bytes, buffers);
                        const members = state.byHash.get(digest);
                        if (members) members.push(candidate);
                        else state.byHash.set(digest, [candidate]);
                    } catch (error) {
                        options.onError?.(candidate, error);
                    } finally {
                        done++;
                        if (--state.pending === 0) finish(state);
                        onProgress?.({ stage, done, total });
                    }
                };
            }
        }
    }

    await runLimited(tasks(), options.concurrency, signal);
    return results;
}

/**
 * Runs tasks from a lazy iterator with at most `concurrency` in flight, so a
 * million-file stage never materializes a million closures up front.
 */
async function runLimited(
    tasks: Iterator<() => Promise<void>>,
    concurrency: number,
    signal: AbortSignal | undefined
): Promise<void> {
    if (signal?.aborted) throw new AbortError();
    let aborted = false;
    const onAbort = (): void => {
        aborted = true;
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const worker = async (): Promise<void> => {
        for (;;) {
            if (aborted) return;
            const next = tasks.next();
            if (next.done) return;
            await next.value();
        }
    };
    try {
        const workers: Array<Promise<void>> = [];
        for (let i = 0; i < concurrency; i++) workers.push(worker());
        await Promise.all(workers);
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
    if (aborted) throw new AbortError();
}

/** Streams a file through SHA-256 and returns the hex digest. */
export async function hashFile(path: string, buffer?: Buffer): Promise<string> {
    const hasher = createHash(ALGORITHM);
    const handle = await open(path, 'r');
    try {
        const chunk = buffer ?? Buffer.allocUnsafe(READ_BUFFER_BYTES);
        let position = 0;
        for (;;) {
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
            if (bytesRead === 0) break;
            hasher.update(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
            position += bytesRead;
        }
    } finally {
        await handle.close();
    }
    return hasher.digest('hex');
}

/** Hashes a file whose size is known: one read for small files, streaming otherwise. */
export async function hashFileOfSize(
    path: string,
    size: number,
    buffers?: BufferPool
): Promise<string> {
    if (size <= SAMPLE_THRESHOLD) return hash(ALGORITHM, await readWhole(path), 'hex');
    const buffer = buffers?.acquire();
    try {
        return await hashFile(path, buffer);
    } finally {
        if (buffer) buffers!.release(buffer);
    }
}

function readWhole(path: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
    });
}

async function sampleHash(path: string, size: number, buffers: BufferPool): Promise<string> {
    const hasher = createHash(ALGORITHM);
    const buffer = buffers.acquire();
    const handle = await open(path, 'r');
    try {
        for (const position of [0, Math.max(0, size - SAMPLE_BYTES)]) {
            const { bytesRead } = await handle.read(buffer, 0, SAMPLE_BYTES, position);
            hasher.update(buffer.subarray(0, bytesRead));
        }
    } finally {
        buffers.release(buffer);
        await handle.close();
    }
    return hasher.digest('hex');
}

function distinctInodes<T extends DuplicateCandidate>(group: T[]): T[] {
    if (group.length < 2) return group;
    const seen = new Set<string>();
    return group.filter((candidate) => {
        const key = `${candidate.dev}:${candidate.ino}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Reuses read buffers so streaming large files allocates a fixed amount of memory. */
class BufferPool {
    readonly #free: Buffer[] = [];

    acquire(): Buffer {
        return this.#free.pop() ?? Buffer.allocUnsafe(READ_BUFFER_BYTES);
    }

    release(buffer: Buffer): void {
        this.#free.push(buffer);
    }
}
