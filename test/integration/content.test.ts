import { chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BufferPool, COMPARE_CHUNK_BYTES, sameContent } from '../../src/core/content.ts';
import { compare } from '../../src/core/compare.ts';
import { bytes, fixture, isRoot, isWindows } from '../helpers/fixture.ts';

const CHUNK = COMPARE_CHUNK_BYTES;

/** A pool that remembers every buffer it handed out. */
class CountingPool extends BufferPool {
    readonly seen = new Set<Buffer>();

    override acquire(): Buffer {
        const buffer = super.acquire();
        this.seen.add(buffer);
        return buffer;
    }
}

function flipped(data: Buffer, at: number): Buffer {
    const copy = Buffer.from(data);
    copy[at] = copy[at]! ^ 0xff;
    return copy;
}

describe('sameContent (#33)', () => {
    const sizes = [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK + 7];

    it.each(sizes)('finds identical files of %i bytes equal', async (size) => {
        const data = bytes(size);
        const root = await fixture({ a: data, b: Buffer.from(data) });
        const pool = new BufferPool(CHUNK);
        expect(await sameContent(join(root, 'a'), join(root, 'b'), size, pool)).toBe(true);
    });

    it.each([
        ['the first byte', 0],
        ['the last byte of the first chunk', CHUNK - 1],
        ['the first byte of the second chunk', CHUNK],
        ['the last byte', 3 * CHUNK + 6],
    ])('finds a difference in %s', async (_, at) => {
        const data = bytes(3 * CHUNK + 7);
        const root = await fixture({ a: data, b: flipped(data, at) });
        const pool = new BufferPool(CHUNK);
        expect(await sameContent(join(root, 'a'), join(root, 'b'), data.length, pool)).toBe(false);
    });

    it('reads to the end, whatever size the scan saw', async () => {
        const data = bytes(2 * CHUNK + 3);
        const root = await fixture({
            a: data,
            b: Buffer.from(data),
            longer: Buffer.concat([data, Buffer.from('x')]),
        });
        const pool = new BufferPool(CHUNK);
        const [a, b, longer] = ['a', 'b', 'longer'].map((name) => join(root, name)) as [
            string,
            string,
            string,
        ];
        // Both grew (or shrank) since the scan, alike: still equal.
        expect(await sameContent(a, b, 10, pool)).toBe(true);
        expect(await sameContent(a, b, 10 * CHUNK, pool)).toBe(true);
        // Only one did: different, even when the scan saw them at the same size.
        expect(await sameContent(a, longer, data.length, pool)).toBe(false);
        expect(await sameContent(longer, a, 10, pool)).toBe(false);
    });

    it('rejects when either file is missing', async () => {
        const root = await fixture({ a: 'abc' });
        const pool = new BufferPool(CHUNK);
        await expect(
            sameContent(join(root, 'a'), join(root, 'missing'), 3, pool)
        ).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(
            sameContent(join(root, 'missing'), join(root, 'a'), 3, pool)
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.skipIf(isWindows)('leaves no file open, whether it succeeds or fails', async () => {
        const root = await fixture({ a: 'abc', b: 'abc', c: 'abd' });
        const pool = new BufferPool(CHUNK);
        const openFds = async (): Promise<number> => (await readdir('/dev/fd')).length;
        const before = await openFds();
        for (let i = 0; i < 20; i++) {
            await sameContent(join(root, 'a'), join(root, 'b'), 3, pool);
            await sameContent(join(root, 'a'), join(root, 'c'), 3, pool);
            await sameContent(join(root, 'a'), join(root, 'missing'), 3, pool).catch(() => {});
            await sameContent(join(root, 'missing'), join(root, 'b'), 3, pool).catch(() => {});
        }
        expect(await openFds()).toBe(before);
    });

    it('reuses two buffers for every comparison made one after another', async () => {
        const data = bytes(2 * CHUNK);
        const root = await fixture({ a: data, b: Buffer.from(data), c: flipped(data, 5) });
        const pool = new CountingPool(CHUNK);
        for (let i = 0; i < 10; i++) {
            await sameContent(join(root, 'a'), join(root, 'b'), data.length, pool);
            await sameContent(join(root, 'a'), join(root, 'c'), data.length, pool);
            await sameContent(join(root, 'a'), join(root, 'missing'), data.length, pool).catch(
                () => {}
            );
        }
        expect(pool.seen.size).toBe(2);
    });
});

describe('compare --content (#33)', () => {
    it('finds a change past the first chunk, and keeps identical large files unchanged', async () => {
        const data = bytes(CHUNK * 2 + 100);
        const root = await fixture({
            'a/late.bin': data,
            'b/late.bin': flipped(data, data.length - 1),
            'a/same.bin': data,
            'b/same.bin': Buffer.from(data),
        });
        const result = await compare(join(root, 'a'), join(root, 'b'), { content: true });
        expect(result.changed.items.map((f) => f.path)).toEqual(['late.bin']);
        expect(result.unchanged).toBe(1);
    });

    it.skipIf(isWindows || isRoot)('reports a file it cannot read as changed', async () => {
        const root = await fixture({
            'a/locked.txt': 'abc',
            'b/locked.txt': 'abc',
            'a/ok': 'x',
            'b/ok': 'x',
        });
        await chmod(join(root, 'b/locked.txt'), 0o000);
        try {
            const result = await compare(join(root, 'a'), join(root, 'b'), { content: true });
            expect(result.changed.items.map((f) => f.path)).toEqual(['locked.txt']);
            expect(result.unchanged).toBe(1);
        } finally {
            await chmod(join(root, 'b/locked.txt'), 0o644);
        }
    });
});
