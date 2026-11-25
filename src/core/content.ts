import { close, open, read } from 'node:fs';

/** Bytes read from each file per step when comparing contents. */
export const COMPARE_CHUNK_BYTES: number = 256 * 1024;

/** Reuses read buffers, so reading many files allocates a fixed amount of memory. */
export class BufferPool {
    readonly #free: Buffer[] = [];
    readonly #bytes: number;

    constructor(bytes: number) {
        this.#bytes = bytes;
    }

    acquire(): Buffer {
        return this.#free.pop() ?? Buffer.allocUnsafe(this.#bytes);
    }

    release(buffer: Buffer): void {
        this.#free.push(buffer);
    }
}

/**
 * Whether two files have the same contents, compared byte by byte in chunks
 * and stopping at the first difference, so no hash is computed and a changed
 * file is usually decided by its first chunk. Both files are read until they
 * end, so a file that grew or shrank since it was measured still compares
 * correctly; `size` (the expected length) only lets a small file be read in a
 * single call. Rejects when either file cannot be opened or read.
 */
export async function sameContent(
    left: string,
    right: string,
    size: number,
    buffers: BufferPool
): Promise<boolean> {
    const a = buffers.acquire();
    const b = buffers.acquire();
    const fds: number[] = [];
    try {
        // Both opens settle before either error is thrown, so neither descriptor leaks.
        const opened = await Promise.allSettled([openFile(left), openFile(right)]);
        for (const result of opened) if (result.status === 'fulfilled') fds.push(result.value);
        const [fdA, fdB] = settled(opened);
        // One byte more than expected: a short read then proves the end of the file.
        let length = Math.min(a.length, size + 1);
        let position = 0;
        for (;;) {
            // Both reads settle before the buffers can go back to the pool.
            const [readA, readB] = settled(
                await Promise.allSettled([
                    readInto(fdA, a, length, position),
                    readInto(fdB, b, length, position),
                ])
            );
            if (readA !== readB) return false;
            if (readA === 0) return true;
            if (a.compare(b, 0, readB, 0, readA) !== 0) return false;
            // A short read is the end of a regular file, on both sides alike.
            if (readA < length) return true;
            position += readA;
            length = a.length;
        }
    } finally {
        await Promise.all(fds.map(closeFile));
        buffers.release(a);
        buffers.release(b);
    }
}

/** The values of two settled promises, or the first failure. */
function settled<T>(results: [PromiseSettledResult<T>, PromiseSettledResult<T>]): [T, T] {
    const [first, second] = results;
    if (first.status === 'rejected') throw first.reason;
    if (second.status === 'rejected') throw second.reason;
    return [first.value, second.value];
}

function openFile(path: string): Promise<number> {
    return new Promise((resolve, reject) => {
        open(path, 'r', (error, fd) => (error ? reject(error) : resolve(fd)));
    });
}

function readInto(fd: number, buffer: Buffer, length: number, position: number): Promise<number> {
    return new Promise((resolve, reject) => {
        read(fd, buffer, 0, length, position, (error, bytesRead) =>
            error ? reject(error) : resolve(bytesRead)
        );
    });
}

function closeFile(fd: number): Promise<void> {
    // A failed close cannot change what was read; there is nothing to report.
    return new Promise((resolve) => close(fd, () => resolve()));
}
