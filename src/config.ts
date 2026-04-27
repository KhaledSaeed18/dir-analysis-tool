import { readFileSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import type { Config } from './types.js';

const CONFIG_FILE_NAMES = ['.dir-analyzer.json', 'dir-analyzer.config.json'];

const ConfigSchema = z.object({
    excludePatterns: z.array(z.string()).optional(),
    clearDefaultExclusions: z.boolean().optional(),
    largeSizeThresholdMB: z.number().optional(),
    enableDuplicateDetection: z.boolean().optional(),
    maxDepth: z.number().int().optional(),
    topN: z.number().int().optional(),
    showEmptyFiles: z.boolean().optional(),
});

async function findConfigFile(startPath: string): Promise<string | null> {
    let current = startPath;
    while (true) {
        for (const name of CONFIG_FILE_NAMES) {
            const candidate = join(current, name);
            try {
                await access(candidate, constants.F_OK);
                return candidate;
            } catch {
                // not found here, keep walking up
            }
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

export async function loadConfig(searchPath?: string): Promise<Config> {
    const configPath = await findConfigFile(searchPath ?? process.cwd());
    if (!configPath) return {};

    try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
        const parsed = ConfigSchema.safeParse(raw);
        if (!parsed.success) {
            console.warn(`Warning: invalid config at ${configPath} — using defaults`);
            return {};
        }
        return parsed.data as Config;
    } catch {
        console.warn(`Warning: could not read config at ${configPath}`);
        return {};
    }
}

export function mergeConfig(fileConfig: Config, cliOptions: Partial<Config>): Config {
    const merged: Config = { ...fileConfig };
    for (const [key, value] of Object.entries(cliOptions) as [keyof Config, unknown][]) {
        if (value !== undefined && value !== null) {
            (merged as Record<string, unknown>)[key] = value;
        }
    }
    return merged;
}
