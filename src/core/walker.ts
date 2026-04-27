import { opendir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface WalkFileEntry {
    kind: 'file';
    path: string;
    name: string;
    size: number;
    mtime: Date;
    ctime: Date;
}

export interface WalkDirEntry {
    kind: 'dir';
    path: string;
    name: string;
}

export type WalkEntry = WalkFileEntry | WalkDirEntry;

export interface WalkOptions {
    maxDepth?: number;
    excludeDirs?: string[];
    excludeFiles?: string[];
    recursive?: boolean;
    clearDefaultExclusions?: boolean;
}

const DEFAULT_EXCLUDE_DIRS = new Set([
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    '.cache',
]);

function matchPattern(name: string, pattern: string): boolean {
    if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        return regex.test(name);
    }
    return name === pattern || name.endsWith(pattern);
}

function shouldExcludeDir(name: string, userExcludes: string[], clearDefaults: boolean): boolean {
    if (!clearDefaults && DEFAULT_EXCLUDE_DIRS.has(name)) return true;
    return userExcludes.some((p) => matchPattern(name, p));
}

function shouldExcludeFile(name: string, userExcludes: string[]): boolean {
    return userExcludes.some((p) => matchPattern(name, p));
}

export async function* walk(root: string, opts: WalkOptions = {}, depth = 0): AsyncGenerator<WalkEntry> {
    const {
        maxDepth = -1,
        excludeDirs = [],
        excludeFiles = [],
        recursive = true,
        clearDefaultExclusions = false,
    } = opts;

    if (maxDepth >= 0 && depth > maxDepth) return;

    let dir;
    try {
        dir = await opendir(root);
    } catch {
        return;
    }

    for await (const entry of dir) {
        const fullPath = join(root, entry.name);

        if (entry.isDirectory()) {
            if (!recursive) continue;
            if (shouldExcludeDir(entry.name, excludeDirs, clearDefaultExclusions)) continue;
            yield { kind: 'dir', path: fullPath, name: entry.name };
            yield* walk(fullPath, opts, depth + 1);
        } else if (entry.isFile()) {
            if (shouldExcludeFile(entry.name, excludeFiles)) continue;
            try {
                const s = await stat(fullPath);
                yield {
                    kind: 'file',
                    path: fullPath,
                    name: entry.name,
                    size: s.size,
                    mtime: s.mtime,
                    ctime: s.birthtime,
                };
            } catch {
                // skip inaccessible files
            }
        }
    }
}
