import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DatError, errorCode, errorMessage } from '../errors.ts';
import { validateConfig, type DatConfig } from './schema.ts';

/** File names recognized during discovery, in priority order. */
export const CONFIG_FILE_NAMES: readonly string[] = [
    '.dir-analyzer.json',
    'dir-analyzer.config.json',
];

export interface LoadedConfig {
    config: DatConfig;
    /** Absolute path of the file that was loaded, or null when none was found. */
    path: string | null;
    warnings: string[];
}

/** Finds the nearest config file at or above `startDir`. */
export function findConfigFile(startDir: string): string | null {
    let current = resolve(startDir);
    for (;;) {
        for (const name of CONFIG_FILE_NAMES) {
            const candidate = join(current, name);
            if (existsSync(candidate)) return candidate;
        }
        const parent = dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

/**
 * Loads configuration from an explicit file, or discovers one by walking up
 * from `searchFrom`. Invalid files are an error rather than silently ignored.
 */
export async function loadConfig(options: {
    file?: string;
    searchFrom: string;
}): Promise<LoadedConfig> {
    const path = options.file ? resolve(options.file) : findConfigFile(options.searchFrom);
    if (!path) return { config: {}, path: null, warnings: [] };

    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (error) {
        throw new DatError(
            errorCode(error) === 'ENOENT'
                ? `Config file not found: ${path}`
                : `Cannot read config ${path}: ${errorMessage(error)}`
        );
    }

    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new DatError(`Invalid JSON in ${path}: ${errorMessage(error)}`);
    }

    const { config, warnings, errors } = validateConfig(raw);
    if (errors.length > 0) {
        throw new DatError(`Invalid config ${path}:\n  - ${errors.join('\n  - ')}`, {
            hint: 'Run "dat init" to generate a valid config, or see https://github.com/KhaledSaeed18/dir-analysis-tool#configuration',
        });
    }
    return { config, path, warnings: warnings.map((w) => `${path}: ${w}`) };
}
