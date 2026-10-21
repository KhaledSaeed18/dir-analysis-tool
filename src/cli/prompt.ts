/**
 * A tiny interactive prompt toolkit built on `node:readline`, so `dat init`
 * does not need a prompt library.
 *
 * Every question returns either the answer or {@link CANCEL}, which is the
 * result when the user presses Ctrl+C, stdin closes, or the CLI is aborted.
 */
import { createInterface, type Interface } from 'node:readline';
import { createStyle, supportsColor, type Style } from '../format/style.ts';
import type { CliIO } from './io.ts';

/** Returned by every prompt when the user cancelled instead of answering. */
export const CANCEL: unique symbol = Symbol('cancel');
export type Cancel = typeof CANCEL;

export interface TextOptions {
    message: string;
    /** Shown dimmed after the question as an example answer. */
    placeholder?: string | undefined;
    /** Used when the user presses Enter without typing anything. */
    defaultValue?: string | undefined;
    /** Returns a problem to show (and ask again), or `undefined` when the value is fine. */
    validate?: ((value: string) => string | undefined) | undefined;
}

export interface ConfirmOptions {
    message: string;
    /** Used when the user presses Enter without typing anything. Defaults to `true`. */
    initialValue?: boolean | undefined;
}

export class Prompter {
    readonly #io: CliIO;
    readonly #style: Style;
    readonly #queued: string[] = [];
    #rl: Interface | null = null;
    #waiting: ((line: string | Cancel) => void) | null = null;
    #closed = false;

    constructor(io: CliIO) {
        this.#io = io;
        this.#style = createStyle(supportsColor(io.stdout, io.env));
    }

    intro(title: string): void {
        this.#write(`\n${this.#style.bold(title)}\n\n`);
    }

    outro(message: string): void {
        this.#write(`\n${this.#style.green('✔')} ${message}\n`);
    }

    cancel(message: string): void {
        this.#write(`\n${this.#style.red('■')} ${message}\n`);
    }

    async text(options: TextOptions): Promise<string | Cancel> {
        const hint = options.placeholder ? ` ${this.#style.dim(`(${options.placeholder})`)}` : '';
        for (;;) {
            const line = await this.#readLine(this.#question(options.message, hint));
            if (line === CANCEL) return CANCEL;
            const value = line.trim();
            const problem = options.validate?.(value);
            if (problem) {
                this.#problem(problem);
                continue;
            }
            return value || (options.defaultValue ?? '');
        }
    }

    async confirm(options: ConfirmOptions): Promise<boolean | Cancel> {
        const initial = options.initialValue ?? true;
        const hint = ` ${this.#style.dim(initial ? '(Y/n)' : '(y/N)')}`;
        for (;;) {
            const line = await this.#readLine(this.#question(options.message, hint));
            if (line === CANCEL) return CANCEL;
            const value = line.trim().toLowerCase();
            if (value === '') return initial;
            if (value === 'y' || value === 'yes') return true;
            if (value === 'n' || value === 'no') return false;
            this.#problem('Please answer yes or no.');
        }
    }

    /** Releases stdin. Call when the questions are over, or the process may not exit. */
    close(): void {
        this.#closed = true;
        this.#rl?.close();
        this.#rl = null;
        this.#waiting?.(CANCEL);
        this.#waiting = null;
    }

    #question(message: string, hint: string): string {
        return `${this.#style.cyan('?')} ${this.#style.bold(message)}${hint} ${this.#style.dim('›')} `;
    }

    #problem(message: string): void {
        this.#write(`${this.#style.red('✖')} ${this.#style.red(message)}\n`);
    }

    #write(text: string): void {
        this.#io.stdout.write(text);
    }

    #readLine(prompt: string): Promise<string | Cancel> {
        if (this.#io.signal?.aborted) return Promise.resolve(CANCEL);
        const rl = this.#closed ? null : this.#open();
        if (!rl && this.#queued.length === 0) return Promise.resolve(CANCEL);
        if (rl && this.#terminal()) {
            rl.setPrompt(prompt);
            rl.prompt();
        } else {
            this.#write(prompt);
        }
        return new Promise((resolve) => {
            const queued = this.#queued.shift();
            if (queued !== undefined) {
                this.#echo(queued);
                resolve(queued);
                return;
            }
            this.#waiting = (line) => {
                this.#waiting = null;
                if (typeof line === 'string') this.#echo(line);
                resolve(line);
            };
        });
    }

    /** Readline echoes typed input on a terminal; when piped, end the line ourselves. */
    #echo(_line: string): void {
        if (!this.#terminal()) this.#write('\n');
    }

    #terminal(): boolean {
        return this.#io.stdinIsTTY && this.#io.stdout.isTTY === true;
    }

    #open(): Interface {
        if (this.#rl) return this.#rl;
        const terminal = this.#terminal();
        const rl = createInterface({
            input: this.#io.stdin ?? process.stdin,
            ...(terminal ? { output: this.#io.stdout } : {}),
            terminal,
        });
        const cancel = (): void => {
            if (terminal) this.#write('\n');
            this.close();
        };
        rl.on('line', (line) => {
            if (this.#waiting) this.#waiting(line);
            else this.#queued.push(line);
        });
        rl.on('SIGINT', cancel);
        rl.on('close', () => {
            // Buffered answers given before the question still count; anything after is cancelled.
            if (this.#queued.length === 0) cancel();
            else this.#closed = true;
        });
        this.#io.signal?.addEventListener('abort', cancel, { once: true });
        this.#rl = rl;
        return rl;
    }
}
