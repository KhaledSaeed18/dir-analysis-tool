import { createHash, hash } from 'node:crypto';
import { close, open, read } from 'node:fs';
import { open as openHandle } from 'node:fs/promises';
import { AbortError } from '../errors.ts';
import { BufferPool } from './content.ts';
import { HashPool, workerCount, type HashJob } from './hash-pool.ts';
import { exactInodeKey } from './scanner.ts';

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
    /** Number of hard links; a file with one link cannot share data with another path. */
    nlink: number;
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
    /**
     * Worker threads that hash a stage with at least {@link workerThreshold}
     * files. Default: {@link workerCount} of `concurrency`; `0` hashes on the
     * main thread only. Either way the results are the same.
     */
    workers?: number | undefined;
    /** Files a stage needs before workers are started. Default: {@link WORKER_THRESHOLD}. */
    workerThreshold?: number | undefined;
}

/**
 * Starting workers takes tens of milliseconds, which hashing this many small
 * files on the main thread costs too.
 */
export const WORKER_THRESHOLD: number = 4096;

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
        const distinct = await distinctInodes(group, options.pathOf);
        if (distinct.length < 2) continue;
        (distinct[0]!.bytes <= SAMPLE_THRESHOLD ? small : large).push(distinct);
    }

    const hashing: Hashing = {
        buffers: new BufferPool(READ_BUFFER_BYTES),
        pool: null,
        workers: options.workers ?? workerCount(options.concurrency),
        threshold: options.workerThreshold ?? WORKER_THRESHOLD,
    };
    try {
        const sampled = await hashStage(large, 'sample', options, hashing);
        for (const group of sampled) small.push(group.members);
        return await hashStage(small, 'full', options, hashing);
    } finally {
        await hashing.pool?.close();
    }
}

/** How a run hashes: pooled buffers on the main thread, and workers once a stage is big. */
interface Hashing {
    buffers: BufferPool;
    pool: HashPool | null;
    workers: number;
    threshold: number;
}

/** Files sent to a worker at once, so messaging costs little per file. */
const WORKER_BATCH = 64;

interface GroupState<T extends DuplicateCandidate> {
    bytes: number;
    pending: number;
    byHash: Map<string, T[]>;
}

async function hashStage<T extends DuplicateCandidate>(
    groups: T[][],
    stage: DuplicateProgress['stage'],
    options: FindDuplicatesOptions<T>,
    hashing: Hashing
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

    /** Records one file's digest, or its error, the same way for both paths. */
    const record = (candidate: T, state: GroupState<T>, digest: string | Error): void => {
        if (typeof digest === 'string') {
            const members = state.byHash.get(digest);
            if (members) members.push(candidate);
            else state.byHash.set(digest, [candidate]);
        } else {
            options.onError?.(candidate, digest);
        }
        done++;
        if (--state.pending === 0) finish(state);
        onProgress?.({ stage, done, total });
    };

    function* files(): Generator<[T, GroupState<T>]> {
        for (const group of groups) {
            const state: GroupState<T> = {
                bytes: group[0]!.bytes,
                pending: group.length,
                byHash: new Map(),
            };
            for (const candidate of group) yield [candidate, state];
        }
    }

    if (hashing.workers > 0 && total >= hashing.threshold) {
        hashing.pool ??= new HashPool(hashing.workers);
        await hashWithWorkers(files(), stage, options, hashing.pool, record);
        return results;
    }

    const { buffers } = hashing;
    function* tasks(): Generator<() => Promise<void>> {
        for (const [candidate, state] of files()) {
            yield async () => {
                let digest: string | Error;
                try {
                    const path = options.pathOf(candidate);
                    digest =
                        stage === 'sample'
                            ? await sampleHash(path, candidate.bytes, buffers)
                            : await hashFileOfSize(path, candidate.bytes, buffers);
                } catch (error) {
                    digest = error instanceof Error ? error : new Error(String(error));
                }
                record(candidate, state, digest);
            };
        }
    }
    await runLimited(tasks(), options.concurrency, signal);
    return results;
}

/**
 * Hashes a stage on the worker pool, in batches, with two batches in flight
 * per worker so none waits for the next. Workers finish in any order; the
 * results are grouped and later sorted the same way as on the main thread.
 */
async function hashWithWorkers<T extends DuplicateCandidate>(
    files: Iterator<[T, GroupState<T>]>,
    stage: DuplicateProgress['stage'],
    options: FindDuplicatesOptions<T>,
    pool: HashPool,
    record: (candidate: T, state: GroupState<T>, digest: string | Error) => void
): Promise<void> {
    const sample = stage === 'sample';
    function* batches(): Generator<() => Promise<void>> {
        for (;;) {
            const batch: Array<[T, GroupState<T>]> = [];
            const jobs: HashJob[] = [];
            while (batch.length < WORKER_BATCH) {
                const next = files.next();
                if (next.done) break;
                const [candidate] = next.value;
                batch.push(next.value);
                jobs.push([options.pathOf(candidate), candidate.bytes, sample]);
            }
            if (batch.length === 0) return;
            yield async () => {
                const outcomes = await pool.run(jobs);
                for (let i = 0; i < batch.length; i++) {
                    const [candidate, state] = batch[i]!;
                    const outcome = outcomes[i]!;
                    record(
                        candidate,
                        state,
                        typeof outcome === 'string'
                            ? outcome
                            : Object.assign(new Error(outcome.message), { code: outcome.code })
                    );
                }
            };
        }
    }
    const signal = options.signal;
    const onAbort = (): void => void pool.close();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        await runLimited(batches(), pool.size * 2, signal);
    } catch (error) {
        throw signal?.aborted ? new AbortError() : error;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
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
    const handle = await openHandle(path, 'r');
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

/**
 * Hashes a file whose size is known: small files in a single read into a
 * pooled buffer, larger ones streamed. Either way the digest covers the
 * whole file as it is now, even if it changed size since it was measured.
 */
export async function hashFileOfSize(
    path: string,
    size: number,
    buffers: BufferPool
): Promise<string> {
    const buffer = buffers.acquire();
    try {
        if (size <= SAMPLE_THRESHOLD) {
            const whole = await readSmall(path, size, buffer);
            if (whole !== null) return hash(ALGORITHM, whole, 'hex');
        }
        return await hashFile(path, buffer);
    } finally {
        buffers.release(buffer);
    }
}

/**
 * Reads a small file with open, one read and close: no `fstat` and no new
 * buffer, unlike `readFile`, and one promise for all three calls. Asking for
 * one byte more than expected makes a short read prove the end of the file.
 * Resolves to null when the file has grown past that, so the caller streams
 * it instead.
 */
function readSmall(path: string, size: number, buffer: Buffer): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
        open(path, 'r', (openError, fd) => {
            if (openError) return reject(openError);
            const wanted = size + 1;
            read(fd, buffer, 0, wanted, 0, (readError, bytesRead) => {
                // A failed close cannot change what was read.
                close(fd, () => {
                    if (readError) reject(readError);
                    else resolve(bytesRead < wanted ? buffer.subarray(0, bytesRead) : null);
                });
            });
        });
    });
}

async function sampleHash(path: string, size: number, buffers: BufferPool): Promise<string> {
    const hasher = createHash(ALGORITHM);
    const buffer = buffers.acquire();
    const handle = await openHandle(path, 'r');
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

/**
 * Drops extra hard links to the same data. Only files with several links can
 * share data, and their identity is exact even where `ino` exceeds 2^53
 * (Windows file IDs); comparing rounded numbers once hid real duplicates.
 */
async function distinctInodes<T extends DuplicateCandidate>(
    group: T[],
    pathOf: (candidate: T) => string
): Promise<T[]> {
    if (group.length < 2) return group;
    const seen = new Set<string>();
    const distinct: T[] = [];
    for (const candidate of group) {
        if (candidate.nlink > 1) {
            let key: string;
            if (Number.isSafeInteger(candidate.ino)) {
                key = `${candidate.dev}:${candidate.ino}`;
            } else {
                try {
                    key = await exactInodeKey(pathOf(candidate));
                } catch {
                    // Unreadable now; hashing will fail and record the error.
                    distinct.push(candidate);
                    continue;
                }
            }
            if (seen.has(key)) continue;
            seen.add(key);
        }
        distinct.push(candidate);
    }
    return distinct;
}
