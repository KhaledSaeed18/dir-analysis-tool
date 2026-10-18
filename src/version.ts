import { createRequire } from 'node:module';
import type { ToolInfo } from './types.ts';

/**
 * Read from the package manifest at runtime, so the reported version always
 * matches the installed package, whatever step of the release built `dist/`.
 * Works from both `src/` (development) and `dist/` (published): each sits one
 * level below the package root.
 */
function readVersion(): string {
    const manifest: unknown = createRequire(import.meta.url)('../package.json');
    if (
        typeof manifest === 'object' &&
        manifest !== null &&
        'version' in manifest &&
        typeof manifest.version === 'string'
    ) {
        return manifest.version;
    }
    return '0.0.0';
}

export const VERSION: string = readVersion();

export const TOOL: ToolInfo = { name: 'dir-analysis-tool', version: VERSION };
