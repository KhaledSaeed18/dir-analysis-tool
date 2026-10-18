import { link, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

export const isWindows: boolean = process.platform === 'win32';
/** Root ignores file permissions, so permission tests are meaningless there. */
export const isRoot: boolean = typeof process.getuid === 'function' && process.getuid() === 0;

export type Entry =
    | string
    | Buffer
    | { content?: string | Buffer; size?: number; mtime?: Date | string }
    | { symlink: string }
    | { hardlink: string }
    | { dir: true };

/** A directory tree described as relative path -> entry. Paths use `/`. */
export type Tree = Record<string, Entry>;

const created: string[] = [];

afterEach(async () => {
    while (created.length > 0) await rm(created.pop()!, { recursive: true, force: true });
});

/** Creates a temporary directory tree, removed automatically after each test. */
export async function fixture(tree: Tree): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'dat-test-'));
    created.push(root);
    await populate(root, tree);
    return root;
}

export async function populate(root: string, tree: Tree): Promise<void> {
    const links: Array<[string, { symlink: string } | { hardlink: string }]> = [];
    for (const [relPath, entry] of Object.entries(tree)) {
        const path = join(root, ...relPath.split('/'));
        if (
            typeof entry === 'object' &&
            !Buffer.isBuffer(entry) &&
            ('symlink' in entry || 'hardlink' in entry)
        ) {
            links.push([relPath, entry]);
            continue;
        }
        if (typeof entry === 'object' && !Buffer.isBuffer(entry) && 'dir' in entry) {
            await mkdir(path, { recursive: true });
            continue;
        }
        await mkdir(dirname(path), { recursive: true });
        if (typeof entry === 'string' || Buffer.isBuffer(entry)) {
            await writeFile(path, entry);
        } else {
            const content = entry.content ?? Buffer.alloc(entry.size ?? 0, 'x');
            await writeFile(path, content);
            if (entry.mtime) {
                const time = new Date(entry.mtime);
                await utimes(path, time, time);
            }
        }
    }
    for (const [relPath, entry] of links) {
        const path = join(root, ...relPath.split('/'));
        await mkdir(dirname(path), { recursive: true });
        if ('symlink' in entry) await symlink(entry.symlink, path);
        else if ('hardlink' in entry) await link(join(root, ...entry.hardlink.split('/')), path);
    }
}

/** Deterministic pseudo-random bytes, so "different content" is reproducible. */
export function bytes(size: number, seed = 1): Buffer {
    const buffer = Buffer.alloc(size);
    let state = seed >>> 0 || 1;
    for (let i = 0; i < size; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        buffer[i] = state & 0xff;
    }
    return buffer;
}
