import type * as Crypto from 'node:crypto';
import type * as Fs from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { AbortError } from '../errors.ts';

/** A file to hash: its path, its size when measured, and whether to hash only the sample. */
export type HashJob = [path: string, size: number, sample: boolean];

/** A hex SHA-256 digest, or why the file could not be read. */
export type HashOutcome = string | { code: string | undefined; message: string };

/** Bytes of the read buffer each worker keeps. */
export const WORKER_BUFFER_BYTES: number = 512 * 1024;

/**
 * Hashes files synchronously, exactly as the in-process path does: SHA-256
 * of the whole file as it is now, or of its first and last 64 KiB for a
 * sample. Runs inside a worker from its source text, so it must not use
 * anything from outside its own body except its arguments and globals.
 */
export function hashJobs(
    jobs: readonly HashJob[],
    fs: typeof Fs,
    crypto: typeof Crypto,
    buffer: Buffer
): HashOutcome[] {
    const SMALL_FILE_BYTES = 256 * 1024;
    const SAMPLE_BYTES = 64 * 1024;
    const results: HashOutcome[] = [];
    for (const [path, size, sample] of jobs) {
        let fd: number | undefined;
        try {
            fd = fs.openSync(path, 'r');
            if (sample) {
                const hasher = crypto.createHash('sha256');
                for (const position of [0, Math.max(0, size - SAMPLE_BYTES)]) {
                    const bytesRead = fs.readSync(fd, buffer, 0, SAMPLE_BYTES, position);
                    hasher.update(buffer.subarray(0, bytesRead));
                }
                results.push(hasher.digest('hex'));
                continue;
            }
            if (size <= SMALL_FILE_BYTES) {
                // One byte more than expected: a short read proves the end of the file.
                const wanted = size + 1;
                const bytesRead = fs.readSync(fd, buffer, 0, wanted, 0);
                if (bytesRead < wanted) {
                    results.push(crypto.hash('sha256', buffer.subarray(0, bytesRead), 'hex'));
                    continue;
                }
            }
            const hasher = crypto.createHash('sha256');
            let position = 0;
            for (;;) {
                const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
                if (bytesRead === 0) break;
                hasher.update(buffer.subarray(0, bytesRead));
                position += bytesRead;
            }
            results.push(hasher.digest('hex'));
        } catch (error) {
            const code =
                error instanceof Error && 'code' in error && typeof error.code === 'string'
                    ? error.code
                    : undefined;
            results.push({ code, message: error instanceof Error ? error.message : String(error) });
        } finally {
            if (fd !== undefined) {
                try {
                    fs.closeSync(fd);
                } catch {
                    // A failed close cannot change what was read.
                }
            }
        }
    }
    return results;
}

const WORKER_SOURCE = `'use strict';
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const crypto = require('node:crypto');
const buffer = Buffer.allocUnsafe(${WORKER_BUFFER_BYTES});
const hashJobs = ${hashJobs.toString()};
parentPort.on('message', (message) => {
    parentPort.postMessage({ id: message.id, results: hashJobs(message.jobs, fs, crypto, buffer) });
});
`;

interface Pending {
    worker: WorkerState;
    resolve: (results: HashOutcome[]) => void;
    reject: (error: unknown) => void;
}

interface WorkerState {
    worker: Worker;
    inFlight: number;
}

/** Workers to start: at most 4, at most the cores less one, at most `limit`. */
export function workerCount(limit: number): number {
    return Math.max(1, Math.min(4, availableParallelism() - 1, limit));
}

/**
 * A fixed set of worker threads that read and hash files, so SHA-256 and
 * the read calls run in parallel instead of on the main thread. Each worker
 * keeps one read buffer, so memory is fixed by the worker count.
 */
export class HashPool {
    readonly #workers: WorkerState[] = [];
    readonly #pending = new Map<number, Pending>();
    #nextId = 0;
    #failure: unknown = null;

    constructor(count: number) {
        for (let i = 0; i < count; i++) {
            const state: WorkerState = {
                worker: new Worker(WORKER_SOURCE, {
                    eval: true,
                    // A worker holds one batch of results at a time; a small young
                    // generation keeps its memory near the isolate's own.
                    resourceLimits: { maxYoungGenerationSizeMb: 2 },
                }),
                inFlight: 0,
            };
            state.worker.on('message', (message: { id: number; results: HashOutcome[] }) => {
                const pending = this.#pending.get(message.id);
                if (!pending) return;
                this.#pending.delete(message.id);
                pending.worker.inFlight--;
                pending.resolve(message.results);
            });
            state.worker.on('error', (error) => this.#fail(error));
            this.#workers.push(state);
        }
    }

    get size(): number {
        return this.#workers.length;
    }

    /** Hashes a batch on the least busy worker; results are in job order. */
    run(jobs: HashJob[]): Promise<HashOutcome[]> {
        if (this.#failure !== null) return Promise.reject(this.#failure);
        let target = this.#workers[0]!;
        for (const state of this.#workers) if (state.inFlight < target.inFlight) target = state;
        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            this.#pending.set(id, { worker: target, resolve, reject });
            target.inFlight++;
            // A worker thread's port, not a window: there is no origin to check.
            // oxlint-disable-next-line unicorn/require-post-message-target-origin
            target.worker.postMessage({ id, jobs });
        });
    }

    /** Stops the workers. Batches still running reject with `reason`. */
    async close(reason: unknown = new AbortError()): Promise<void> {
        this.#fail(reason);
        await Promise.all(this.#workers.map((state) => state.worker.terminate()));
    }

    #fail(reason: unknown): void {
        if (this.#failure === null) this.#failure = reason;
        for (const pending of this.#pending.values()) pending.reject(this.#failure);
        this.#pending.clear();
    }
}
