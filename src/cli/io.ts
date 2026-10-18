import type { Writable } from 'node:stream';

export type OutputStream = Writable & { isTTY?: boolean | undefined; columns?: number | undefined };

/** Everything the CLI touches outside itself, injectable for tests. */
export interface CliIO {
    stdout: OutputStream;
    stderr: OutputStream;
    stdinIsTTY: boolean;
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

/** Writes to a stream and waits until the data is flushed (important for large piped output). */
export function write(stream: OutputStream, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(text, (error) => (error ? reject(error) : resolve()));
    });
}

export function terminalWidth(io: CliIO): number {
    const fromEnv = Number(io.env['COLUMNS']);
    return io.stdout.columns ?? (Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 100);
}
