import type { Readable, Writable } from 'node:stream';
import { errorCode } from '../errors.ts';

export type OutputStream = Writable & { isTTY?: boolean | undefined; columns?: number | undefined };

/** Everything the CLI touches outside itself, injectable for tests. */
export interface CliIO {
    stdout: OutputStream;
    stderr: OutputStream;
    stdinIsTTY: boolean;
    /** Where interactive prompts read answers from. Defaults to `process.stdin`. */
    stdin?: Readable | undefined;
    env: Record<string, string | undefined>;
    cwd: string;
    /** Aborted when the user interrupts the process (Ctrl+C). */
    signal?: AbortSignal | undefined;
}

export function processIO(signal?: AbortSignal): CliIO {
    return {
        stdout: process.stdout,
        stderr: process.stderr,
        stdinIsTTY: process.stdin.isTTY,
        stdin: process.stdin,
        env: process.env,
        cwd: process.cwd(),
        signal,
    };
}

/** Exit codes, documented in the README. */
export const ExitCode = {
    Ok: 0,
    Error: 1,
    BudgetFailed: 2,
    Interrupted: 130,
} as const;

const closedStreams = new WeakSet<OutputStream>();

/** Errors that mean the reader went away (`dat --json | head`), which is not a failure of dat. */
function isClosedPipe(error: unknown): boolean {
    const code = errorCode(error);
    return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

/**
 * Treats a closed pipe on `stream` as the end of its output instead of an
 * error: later writes are dropped, and the run still ends with its own exit
 * code (a failed budget stays 2). Any other stream error is rethrown.
 */
export function ignoreClosedPipe(stream: OutputStream): void {
    stream.on('error', (error: Error) => {
        if (!isClosedPipe(error)) throw error;
        closedStreams.add(stream);
    });
}

/** True once a reader closed the stream early. */
export function isClosed(stream: OutputStream): boolean {
    return closedStreams.has(stream);
}

/**
 * Writes to a stream and waits until the data is flushed (important for large
 * piped output). Resolves without writing once the reader has closed the pipe.
 */
export function write(stream: OutputStream, text: string): Promise<void> {
    if (closedStreams.has(stream)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        stream.write(text, (error) => {
            if (!error) return resolve();
            if (!isClosedPipe(error)) return reject(error);
            closedStreams.add(stream);
            resolve();
        });
    });
}

export function terminalWidth(io: CliIO): number {
    const fromEnv = Number(io.env['COLUMNS']);
    return io.stdout.columns ?? (Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 100);
}
