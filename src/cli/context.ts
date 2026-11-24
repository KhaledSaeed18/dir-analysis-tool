import { constants } from 'node:fs';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { loadConfig, type LoadedConfig } from '../config/load.ts';
import { createStyle, supportsColor, type Style } from '../format/style.ts';
import { DatError, errorCode, errorMessage } from '../errors.ts';
import { escapeControl, escapeControlInLines } from '../format/text.ts';
import type { CliIO } from './io.ts';
import { isClosed, write } from './io.ts';

/** Shared state for one CLI invocation. */
export class Context {
    readonly io: CliIO;
    /** Styling for stderr messages. */
    readonly err: Style;
    exitCode = 0;

    constructor(io: CliIO) {
        this.io = io;
        this.err = createStyle(supportsColor(io.stderr, io.env));
    }

    resolvePath(path: string): string {
        return resolve(this.io.cwd, path);
    }

    /** Style for the main output: plain when writing to a file or when colors are off. */
    outputStyle(color: boolean | undefined, toFile: boolean): Style {
        if (toFile) return createStyle(false);
        return createStyle(color ?? supportsColor(this.io.stdout, this.io.env));
    }

    info(message: string, quiet: boolean): void {
        if (!quiet) this.io.stderr.write(`${message}\n`);
    }

    warn(message: string): void {
        // Warnings can quote a config file, which may come from an untrusted repository.
        this.io.stderr.write(`${this.err.yellow('warning')} ${escapeControlInLines(message)}\n`);
    }

    async loadConfig(cli: Record<string, unknown>, searchFrom: string): Promise<LoadedConfig> {
        if (cli['config'] === false) return { config: {}, path: null, warnings: [] };
        const file =
            typeof cli['config'] === 'string' ? this.resolvePath(cli['config']) : undefined;
        const loaded = await loadConfig({ ...(file ? { file } : {}), searchFrom });
        for (const warning of loaded.warnings) this.warn(warning);
        return loaded;
    }

    /** A path for messages: relative to the working directory when inside it, escaped. */
    displayPath(file: string): string {
        const rel = relative(this.io.cwd, file);
        return escapeControl(rel && !rel.startsWith('..') ? rel : file);
    }

    /**
     * Fails before any work starts when `path` can't be written: it is a directory, a parent is a
     * file, or the folder is read-only. Creates nothing. `what` names the file in the message.
     */
    async checkOutput(path: string, what = 'the report'): Promise<void> {
        const absolute = this.resolvePath(path);
        const problem = await outputProblem(absolute, (p) => this.displayPath(p));
        if (problem) throw this.#outputError(absolute, what, problem);
    }

    async writeFile(path: string, content: string, what = 'the report'): Promise<string> {
        const absolute = this.resolvePath(path);
        try {
            await mkdir(dirname(absolute), { recursive: true });
            await writeFile(absolute, content);
        } catch (error) {
            // The path changed since checkOutput, or the disk is full: still a plain message.
            const problem =
                (await outputProblem(absolute, (p) => this.displayPath(p))) ?? errorMessage(error);
            throw this.#outputError(absolute, what, problem);
        }
        return absolute;
    }

    #outputError(absolute: string, what: string, problem: string): DatError {
        const shown = this.displayPath(absolute);
        const hint =
            problem === 'it is a directory'
                ? `Give a file name, for example ${shown}${sep}${exampleName(what)}.`
                : undefined;
        return new DatError(`Cannot write ${what} to ${shown}: ${problem}`, hint ? { hint } : {});
    }

    stdout(text: string): Promise<void> {
        return write(this.io.stdout, text);
    }

    /** True once the reader of stdout went away (`dat watch --json | head -1`). */
    get stdoutClosed(): boolean {
        return isClosed(this.io.stdout);
    }
}

/** Why `file` can't be written, or null when it can (as far as can be told without writing). */
async function outputProblem(file: string, show: (path: string) => string): Promise<string | null> {
    try {
        const stats = await stat(file);
        if (stats.isDirectory()) return 'it is a directory';
        return (await writable(file)) ? null : 'permission denied';
    } catch (error) {
        const code = errorCode(error);
        if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
        if (code !== 'ENOENT' && code !== 'ENOTDIR') return errorMessage(error);
    }
    // The file doesn't exist: the nearest existing ancestor must be a writable directory.
    for (let dir = dirname(file); ; dir = dirname(dir)) {
        try {
            const stats = await stat(dir);
            if (!stats.isDirectory()) return `${show(dir)} is not a directory`;
            return (await writable(dir)) ? null : 'permission denied';
        } catch (error) {
            const code = errorCode(error);
            if (code !== 'ENOENT' && code !== 'ENOTDIR') {
                return code === 'EACCES' || code === 'EPERM'
                    ? 'permission denied'
                    : errorMessage(error);
            }
            if (dirname(dir) === dir) return null;
        }
    }
}

async function writable(path: string): Promise<boolean> {
    return access(path, constants.W_OK).then(
        () => true,
        () => false
    );
}

function exampleName(what: string): string {
    if (what.includes('HTML')) return 'report.html';
    if (what.includes('CSV')) return 'report.csv';
    return 'report.txt';
}
