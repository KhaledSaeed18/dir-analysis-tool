import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadConfig, type LoadedConfig } from '../config/load.ts';
import { createStyle, supportsColor, type Style } from '../format/style.ts';
import type { CliIO } from './io.ts';
import { write } from './io.ts';

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
        this.io.stderr.write(`${this.err.yellow('warning')} ${message}\n`);
    }

    async loadConfig(cli: Record<string, unknown>, searchFrom: string): Promise<LoadedConfig> {
        if (cli['config'] === false) return { config: {}, path: null, warnings: [] };
        const file =
            typeof cli['config'] === 'string' ? this.resolvePath(cli['config']) : undefined;
        const loaded = await loadConfig({ ...(file ? { file } : {}), searchFrom });
        for (const warning of loaded.warnings) this.warn(warning);
        return loaded;
    }

    async writeFile(path: string, content: string): Promise<string> {
        const absolute = this.resolvePath(path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, content);
        return absolute;
    }

    stdout(text: string): Promise<void> {
        return write(this.io.stdout, text);
    }
}
