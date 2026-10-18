import { Writable } from 'node:stream';
import { run } from '../../src/cli/program.ts';
import type { CliIO } from '../../src/cli/io.ts';

export interface CliResult {
    code: number;
    stdout: string;
    stderr: string;
}

class Capture extends Writable {
    text = '';
    isTTY: boolean;
    columns: number | undefined;

    readonly #onWrite: ((text: string) => void) | undefined;

    constructor(isTTY = false, columns?: number, onWrite?: (text: string) => void) {
        super();
        this.isTTY = isTTY;
        this.columns = columns;
        this.#onWrite = onWrite;
    }

    override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
        this.text += chunk.toString();
        this.#onWrite?.(this.text);
        callback();
    }
}

export interface RunOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    tty?: boolean;
    signal?: AbortSignal;
    stdinTTY?: boolean;
    /** Receives stdout as it is written. */
    onStdout?: (text: string) => void;
}

/** Runs the CLI in-process with captured, non-TTY output and no colors. */
export async function cli(args: string[], options: RunOptions = {}): Promise<CliResult> {
    const stdout = new Capture(options.tty ?? false, 100, options.onStdout);
    const stderr = new Capture(options.tty ?? false, 100);
    const io: CliIO = {
        stdout,
        stderr,
        stdinIsTTY: options.stdinTTY ?? false,
        env: { NO_COLOR: '1', ...options.env },
        cwd: options.cwd ?? process.cwd(),
        signal: options.signal,
    };
    const code = await run(args, io);
    return { code, stdout: stdout.text, stderr: stderr.text };
}

export function json<T = Record<string, unknown>>(result: CliResult): T {
    return JSON.parse(result.stdout) as T;
}
