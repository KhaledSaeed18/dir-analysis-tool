import type { Stats } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { fixture, isWindows } from '../helpers/fixture.ts';

/**
 * Windows NTFS file IDs keep a sequence number in their top 16 bits, so they
 * often exceed 2^53 and different files round to the same `Stats.ino` Number.
 * Here every Number `ino` is the same unsafe value, the worst case of that
 * rounding; bigint stats still report the real IDs.
 */
const ROUNDED_INO = 2 ** 60;

vi.mock('node:fs/promises', async (importOriginal) => {
    const fs = await importOriginal<typeof FsPromises>();
    const round = (stats: Stats): Stats => {
        Object.defineProperty(stats, 'ino', { value: ROUNDED_INO });
        return stats;
    };
    const wrap =
        (original: typeof fs.stat) =>
        async (...args: Parameters<typeof fs.stat>): Promise<unknown> => {
            const options = args[1];
            const result = await original(...args);
            if (typeof options === 'object' && options?.bigint) return result;
            return round(result as Stats);
        };
    return { ...fs, stat: wrap(fs.stat), lstat: wrap(fs.lstat) };
});

describe('file identity above 2^53 (Windows file IDs)', () => {
    it('still finds duplicates among single-link files', async () => {
        const root = await fixture({ 'a.txt': 'hello', 'b.txt': 'hello', 'c.txt': 'other' });
        const result = await analyze(root, { duplicates: true });
        expect(result.summary.files).toBe(3);
        expect(result.duplicates?.count).toBe(1);
        expect(result.duplicates?.items[0]?.files).toEqual(['a.txt', 'b.txt']);
    });

    it.skipIf(isWindows)('tells hard links from distinct multi-link files', async () => {
        const root = await fixture({
            'one.txt': 'same',
            'one-link.txt': { hardlink: 'one.txt' },
            'two.txt': 'same',
            'two-link.txt': { hardlink: 'two.txt' },
        });
        const result = await analyze(root, { duplicates: true });
        // Two pairs of hard links: each pair counted once, and the pairs are copies.
        expect(result.summary.files).toBe(2);
        expect(result.summary.hardlinks).toBe(2);
        expect(result.duplicates?.count).toBe(1);
        expect(result.duplicates?.items[0]?.files).toHaveLength(2);
    });

    it.skipIf(isWindows)('enters every directory and file when following symlinks', async () => {
        const root = await fixture({
            'a/x.txt': 'x',
            'b/y.txt': 'y',
            'c/z.txt': 'z',
            link: { symlink: 'a' },
        });
        const result = await analyze(root, { followSymlinks: true });
        expect(result.summary.files).toBe(3);
        expect(result.summary.directories).toBe(3); // a, b, c; the root is not counted
    });
});
