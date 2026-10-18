import { describe, expect, it } from 'vitest';
import { classify, emptyTypeStats, extensionOf } from '../../src/core/classify.ts';
import { Limiter } from '../../src/core/limiter.ts';
import { comparePaths, joinRelative } from '../../src/core/paths.ts';
import { TopK } from '../../src/core/top.ts';
import { CATEGORIES } from '../../src/types.ts';

describe('classify', () => {
    it.each([
        ['index.ts', 'code'],
        ['photo.JPG', 'images'],
        ['movie.mkv', 'videos'],
        ['song.flac', 'audio'],
        ['report.pdf', 'documents'],
        ['backup.tar.gz', 'archives'],
        ['font.woff2', 'fonts'],
        ['table.parquet', 'data'],
        ['Dockerfile', 'code'],
        ['Makefile', 'code'],
        ['LICENSE', 'documents'],
        ['.env', 'code'],
        ['.env.local', 'code'],
        ['mystery', 'other'],
        ['weird.', 'other'],
    ])('%s is %s', (name, category) => {
        expect(classify(name)).toBe(category);
    });

    it('extracts extensions', () => {
        expect(extensionOf('a.TXT')).toBe('.txt');
        expect(extensionOf('.gitignore')).toBe('');
        expect(extensionOf('archive.tar.gz')).toBe('.gz');
        expect(extensionOf('trailing.')).toBe('');
    });

    it('creates zeroed stats for every category', () => {
        expect(Object.keys(emptyTypeStats()).sort()).toEqual([...CATEGORIES].sort());
    });
});

describe('TopK', () => {
    it('keeps the largest items, sorted', () => {
        const top = new TopK<string>(3, (a, b) => comparePaths(a, b));
        for (const [score, item] of [
            [5, 'e'],
            [1, 'a'],
            [9, 'i'],
            [7, 'g'],
            [3, 'c'],
        ] as const) {
            top.push(score, item);
        }
        expect(top.sorted()).toEqual(['i', 'g', 'e']);
        expect(top.size).toBe(3);
    });

    it('breaks ties deterministically regardless of insertion order', () => {
        const forward = new TopK<string>(2, comparePaths);
        const backward = new TopK<string>(2, comparePaths);
        const items = ['d', 'b', 'a', 'c'];
        for (const item of items) forward.push(1, item);
        for (const item of items.toReversed()) backward.push(1, item);
        expect(forward.sorted()).toEqual(['a', 'b']);
        expect(backward.sorted()).toEqual(['a', 'b']);
    });

    it('accepts nothing when the limit is zero', () => {
        const top = new TopK<number>(0);
        expect(top.accepts(100)).toBe(false);
        top.push(100, 1);
        expect(top.sorted()).toEqual([]);
    });
});

describe('Limiter', () => {
    it('never exceeds its concurrency and waits for nested tasks', async () => {
        const limiter = new Limiter(2);
        let active = 0;
        let peak = 0;
        let done = 0;
        const task = (spawn: boolean) => async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            if (spawn) limiter.run(task(false));
            active--;
            done++;
        };
        for (let i = 0; i < 6; i++) limiter.run(task(true));
        await limiter.idle();
        expect(done).toBe(12);
        expect(peak).toBe(2);
    });

    it('resolves immediately when idle and rejects after abort', async () => {
        const limiter = new Limiter(1);
        await expect(limiter.idle()).resolves.toBeUndefined();
        limiter.run(() => new Promise((resolve) => setTimeout(resolve, 50)));
        const idle = limiter.idle();
        limiter.abort(new Error('stop'));
        await expect(idle).rejects.toThrow('stop');
        await expect(limiter.idle()).rejects.toThrow('stop');
        limiter.run(async () => {});
    });

    it('turns a failing task into a rejection', async () => {
        const limiter = new Limiter(1);
        limiter.run(async () => {
            throw new Error('boom');
        });
        await expect(limiter.idle()).rejects.toThrow('boom');
    });

    it('validates its concurrency', () => {
        expect(() => new Limiter(0)).toThrow(RangeError);
    });
});

describe('paths', () => {
    it('compares ordinally', () => {
        expect(['b', 'B', 'a'].sort(comparePaths)).toEqual(['B', 'a', 'b']);
        expect(joinRelative('/root', '')).toBe('/root');
    });

    it.skipIf(process.platform === 'win32')('joins posix paths', () => {
        expect(joinRelative('/root', 'a/b')).toBe('/root/a/b');
        expect(joinRelative('/', 'a')).toBe('/a');
    });

    it.runIf(process.platform === 'win32')('joins windows paths', () => {
        expect(joinRelative('C:\\root', 'a/b')).toBe('C:\\root\\a\\b');
    });
});
