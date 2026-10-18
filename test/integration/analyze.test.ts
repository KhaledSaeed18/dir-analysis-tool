import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { AbortError, DatError } from '../../src/errors.ts';
import { bytes, fixture, isRoot, isWindows } from '../helpers/fixture.ts';

const KiB = 1024;

describe('analyze: totals and breakdowns', () => {
    it('counts files, folders, and bytes, and classifies them', async () => {
        const root = await fixture({
            'src/index.ts': 'x'.repeat(100),
            'src/util/helpers.ts': 'x'.repeat(50),
            'docs/guide.md': 'x'.repeat(30),
            'assets/logo.png': bytes(2 * KiB),
            Dockerfile: 'FROM node',
            empty: { dir: true },
        });
        const result = await analyze(root);
        expect(result.schemaVersion).toBe(3);
        expect(result.root).toBe(root);
        expect(result.summary).toMatchObject({
            files: 5,
            directories: 5,
            bytes: 100 + 50 + 30 + 2048 + 9,
            errors: 0,
        });
        expect(result.summary.largestFileBytes).toBe(2048);
        expect(result.types.code).toEqual({ files: 3, bytes: 159 });
        expect(result.types.images).toEqual({ files: 1, bytes: 2048 });
        expect(result.types.documents).toEqual({ files: 1, bytes: 30 });
        expect(result.types.videos).toEqual({ files: 0, bytes: 0 });
        expect(result.extensions[0]).toEqual({ extension: '.png', files: 1, bytes: 2048 });
        expect(result.extensions.find((e) => e.extension === '')).toEqual({
            extension: '',
            files: 1,
            bytes: 9,
        });
        expect(result.errors).toEqual([]);
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    });

    it('lists the largest files and folders with posix paths, deterministically', async () => {
        const root = await fixture({
            'a/one.bin': bytes(300),
            'a/two.bin': bytes(300, 2),
            'b/c/three.bin': bytes(500),
            'top.bin': bytes(100),
        });
        const result = await analyze(root, { top: 2 });
        expect(result.largestFiles.map((f) => f.path)).toEqual(['b/c/three.bin', 'a/one.bin']);
        expect(result.largestFiles[0]!.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        // "b" holds nothing but "b/c", so it is folded into it.
        expect(result.largestDirectories).toEqual([
            { path: 'a', bytes: 600, files: 2 },
            { path: 'b/c', bytes: 500, files: 1 },
        ]);
        const again = await analyze(root, { top: 2 });
        expect(again.largestFiles).toEqual(result.largestFiles);
    });

    it('turns the top lists off with top: 0', async () => {
        const root = await fixture({ 'a/x.txt': 'x' });
        const result = await analyze(root, { top: 0 });
        expect(result.largestFiles).toEqual([]);
        expect(result.largestDirectories).toEqual([]);
        expect(result.summary.largestFileBytes).toBe(1);
    });

    it('reports disk usage separately from apparent size', async () => {
        const root = await fixture({ 'f.bin': bytes(10) });
        const result = await analyze(root);
        expect(result.summary.bytes).toBe(10);
        expect(result.summary.diskBytes).toBeGreaterThanOrEqual(isWindows ? 10 : 0);
    });
});

describe('analyze: exclusions', () => {
    it('skips .git and node_modules by default, and includes them on request', async () => {
        const root = await fixture({
            'node_modules/pkg/index.js': 'x',
            '.git/HEAD': 'ref',
            'src/node_modules/inner.js': 'x',
            'src/app.js': 'x',
        });
        const result = await analyze(root);
        expect(result.summary.files).toBe(1);
        expect(result.summary.excluded).toBe(3);
        expect((await analyze(root, { defaultExcludes: false })).summary.files).toBe(4);
    });

    it('excludes files and folders by gitignore-style pattern (v2 ignored file patterns)', async () => {
        const root = await fixture({
            'app.log': 'x',
            'src/deep/debug.log': 'x',
            'src/main.ts': 'x',
            'build/out.js': 'x',
            'docs/a/manual.pdf': 'x',
            'docs/b.pdf': 'x',
        });
        const result = await analyze(root, { exclude: ['*.log', 'build/', 'docs/a/**'] });
        expect(result.largestFiles.map((f) => f.path).sort()).toEqual([
            'docs/b.pdf',
            'src/main.ts',
        ]);
        // Two logs, build/, and the file under docs/a/ (the folder itself is entered).
        expect(result.summary.excluded).toBe(4);
    });

    it('honors nested .gitignore files with negation when asked', async () => {
        const root = await fixture({
            '.gitignore': '*.tmp\nsecret/\n',
            'keep.txt': 'x',
            'a.tmp': 'x',
            'secret/key': 'x',
            'pkg/.gitignore': '!important.tmp\n/local.txt\n',
            'pkg/important.tmp': 'x',
            'pkg/other.tmp': 'x',
            'pkg/local.txt': 'x',
            'pkg/sub/local.txt': 'x',
        });
        const without = await analyze(root);
        expect(without.summary.files).toBe(9);
        const result = await analyze(root, { gitignore: true, top: 20 });
        expect(result.largestFiles.map((f) => f.path).sort()).toEqual([
            '.gitignore',
            'keep.txt',
            'pkg/.gitignore',
            'pkg/important.tmp',
            'pkg/sub/local.txt',
        ]);
    });

    it('applies ancestor .gitignore files when scanning inside a repository', async () => {
        const repo = await fixture({
            '.git/info/exclude': '*.secret\n',
            '.gitignore': 'packages/app/dist/\n',
            'packages/.gitignore': '*.cache\n',
            'packages/app/src/a.ts': 'x',
            'packages/app/src/b.cache': 'x',
            'packages/app/src/c.secret': 'x',
            'packages/app/dist/bundle.js': 'x',
        });
        const result = await analyze(join(repo, 'packages', 'app'), { gitignore: true, top: 20 });
        expect(result.largestFiles.map((f) => f.path)).toEqual(['src/a.ts']);
    });

    it('limits depth', async () => {
        const root = await fixture({ 'top.txt': 'x', 'a/one.txt': 'x', 'a/b/two.txt': 'x' });
        expect((await analyze(root, { maxDepth: 0 })).summary).toMatchObject({
            files: 1,
            directories: 0,
        });
        expect((await analyze(root, { maxDepth: 1 })).summary).toMatchObject({
            files: 2,
            directories: 1,
        });
        expect((await analyze(root)).summary).toMatchObject({ files: 3, directories: 2 });
    });
});

describe('analyze: filters', () => {
    it('filters by size with human units', async () => {
        const root = await fixture({
            small: bytes(100),
            medium: bytes(2 * KiB),
            big: bytes(10 * KiB),
        });
        const result = await analyze(root, { minSize: '1k', maxSize: '5KiB' });
        expect(result.summary).toMatchObject({ files: 1, filtered: 2, bytes: 2048 });
    });

    it('filters by modification time; date-only upper bounds include the whole day (v2 dropped it)', async () => {
        const today = new Date();
        const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const root = await fixture({
            'old.txt': { content: 'x', mtime: '2020-06-01T12:00:00Z' },
            'new.txt': 'x',
        });
        expect((await analyze(root, { modifiedBefore: ymd })).summary.files).toBe(2);
        expect((await analyze(root, { modifiedBefore: '2021-01-01' })).summary.files).toBe(1);
        expect((await analyze(root, { modifiedAfter: '30d' })).summary.files).toBe(1);
        expect((await analyze(root, { modifiedAfter: new Date('2019-01-01') })).summary.files).toBe(
            2
        );
    });

    it('validates options', async () => {
        const root = await fixture({ a: 'x' });
        await expect(analyze(root, { minSize: '10k', maxSize: '1k' })).rejects.toThrow(DatError);
        await expect(
            analyze(root, { modifiedAfter: '2025-01-02', modifiedBefore: '2025-01-01' })
        ).rejects.toThrow(/later/);
        await expect(analyze(root, { minSize: 'lots' })).rejects.toThrow(/minSize/);
        await expect(analyze(root, { maxDepth: -1 })).rejects.toThrow(/maxDepth/);
        await expect(analyze(root, { top: 1.5 })).rejects.toThrow(/top/);
        await expect(analyze(root, { concurrency: 0 })).rejects.toThrow(/concurrency/);
        await expect(analyze(root, { tree: { depth: 0 } })).rejects.toThrow(/tree depth/);
        await expect(analyze(root, { stale: 'whenever' })).rejects.toThrow(/stale/);
        await expect(analyze(root, { budgets: ['speed<1'] })).rejects.toThrow(
            /Unknown budget metric/
        );
    });

    it('rejects missing roots and files', async () => {
        const root = await fixture({ 'file.txt': 'x' });
        await expect(analyze(join(root, 'nope'))).rejects.toThrow(/No such directory/);
        await expect(analyze(join(root, 'file.txt'))).rejects.toThrow(/Not a directory/);
    });
});

describe('analyze: links', () => {
    it.skipIf(isWindows)('counts hard-linked data once', async () => {
        const root = await fixture({ 'a.bin': bytes(4 * KiB), 'b.bin': { hardlink: 'a.bin' } });
        const result = await analyze(root, { duplicates: true });
        expect(result.summary).toMatchObject({ files: 1, bytes: 4096, hardlinks: 1 });
        expect(result.duplicates?.count).toBe(0);
        const counted = await analyze(root, { countHardlinks: true, duplicates: true });
        expect(counted.summary).toMatchObject({ files: 2, bytes: 8192 });
        expect(counted.duplicates?.count).toBe(0); // links share data; they are not copies
    });

    it.skipIf(isWindows)(
        'does not follow symlinks by default, and follows them safely on request',
        async () => {
            const root = await fixture({
                'real/data.bin': bytes(1000),
                'link.bin': { symlink: 'real/data.bin' },
                alias: { symlink: 'real' },
                'real/loop': { symlink: '..' },
                dangling: { symlink: 'missing' },
            });
            const plain = await analyze(root);
            expect(plain.summary).toMatchObject({
                files: 1,
                bytes: 1000,
                symlinks: 4,
                directories: 1,
            });
            const followed = await analyze(root, { followSymlinks: true });
            expect(followed.summary).toMatchObject({
                files: 1,
                bytes: 1000,
                directories: 1,
                errors: 0,
            });
        }
    );
});

describe('analyze: reports', () => {
    it('lists large files at a threshold', async () => {
        const root = await fixture({ a: bytes(3 * KiB), b: bytes(KiB), c: bytes(5 * KiB) });
        const result = await analyze(root, { largeFiles: '2k' });
        expect(result.largeFiles).toMatchObject({ threshold: 2048, count: 2, bytes: 8 * KiB });
        expect(result.largeFiles?.items.map((f) => f.path)).toEqual(['c', 'a']);
        expect((await analyze(root, { largeFiles: true })).largeFiles?.threshold).toBe(
            100 * KiB * KiB
        );
        expect((await analyze(root, { largeFiles: false })).largeFiles).toBeUndefined();
    });

    it('finds duplicates in stages, ignoring empty files and same-size lookalikes', async () => {
        const large = bytes(600 * KiB, 7);
        const sameEnds = Buffer.from(large);
        // Differs only in the middle, so it survives the sample stage and needs a full hash.
        sameEnds.writeUInt8(sameEnds.readUInt8(300 * KiB) ^ 0xff, 300 * KiB);
        const root = await fixture({
            'a/photo.jpg': large,
            'b/photo-copy.jpg': large,
            'c/photo-copy-2.jpg': large,
            'lookalike.jpg': sameEnds,
            'x.txt': 'hello',
            'y.txt': 'hello',
            'z.txt': 'world',
            empty1: '',
            empty2: '',
        });
        const result = await analyze(root, { duplicates: true });
        const d = result.duplicates!;
        expect(d.count).toBe(2);
        expect(d.files).toBe(5);
        expect(d.wastedBytes).toBe(2 * large.length + 5);
        expect(d.items[0]).toMatchObject({
            bytes: large.length,
            wastedBytes: 2 * large.length,
            files: ['a/photo.jpg', 'b/photo-copy.jpg', 'c/photo-copy-2.jpg'],
        });
        expect(d.items[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(d.items[1]!.files).toEqual(['x.txt', 'y.txt']);
    });

    it('respects the minimum duplicate size and reports hashing progress', async () => {
        const root = await fixture({ a: 'same', b: 'same', c: bytes(KiB), d: bytes(KiB) });
        const stages = new Set<string>();
        const result = await analyze(root, {
            duplicates: true,
            minDuplicateSize: 100,
            onProgress: (p) => {
                if (p.phase === 'hash') stages.add(p.stage);
            },
        });
        expect(result.duplicates?.items.map((g) => g.files)).toEqual([['c', 'd']]);
        expect(stages.has('full')).toBe(true);
    });

    it('lists empty files and empty folders', async () => {
        const root = await fixture({
            e1: '',
            'sub/e2': '',
            full: 'x',
            hollow: { dir: true },
            'sub/inner': { dir: true },
        });
        const result = await analyze(root, { empty: true });
        expect(result.emptyFiles).toMatchObject({ count: 2 });
        expect(result.emptyFiles?.items.map((f) => f.path)).toEqual(['e1', 'sub/e2']);
        expect(result.emptyDirectories).toEqual({ count: 2, items: ['hollow', 'sub/inner'] });
    });

    it('lists stale files', async () => {
        const root = await fixture({
            'ancient.txt': { content: 'xx', mtime: '2015-01-01T00:00:00Z' },
            'old.txt': { content: 'x', mtime: '2020-01-01T00:00:00Z' },
            'fresh.txt': 'x',
        });
        const result = await analyze(root, { stale: '2021-01-01' });
        expect(result.staleFiles).toMatchObject({ count: 2, bytes: 3 });
        expect(result.staleFiles?.items.map((f) => f.path)).toEqual(['ancient.txt', 'old.txt']);
        expect((await analyze(root, { stale: true })).staleFiles?.count).toBe(2);
        expect((await analyze(root, { stale: new Date('2016-01-01') })).staleFiles?.count).toBe(1);
        expect((await analyze(root, { stale: Date.parse('2030-01-01') })).staleFiles?.count).toBe(
            3
        );
    });

    it('builds a size tree with per-level limits', async () => {
        const root = await fixture({
            'a/big.bin': bytes(500),
            'a/b/c/deep.bin': bytes(50),
            'a/s1': bytes(1),
            'a/s2': bytes(2),
            'a/s3': bytes(3),
            'root.bin': bytes(10),
        });
        const result = await analyze(root, { tree: { depth: 2, limit: 3 } });
        const tree = result.tree!;
        expect(tree).toMatchObject({
            name: '.',
            path: '',
            type: 'directory',
            bytes: 566,
            files: 6,
        });
        expect(tree.children?.map((c) => c.path)).toEqual(['a', 'root.bin']);
        const a = tree.children![0]!;
        expect(a.children?.map((c) => c.name)).toEqual(['big.bin', 'b', 's3']);
        expect(a.omitted).toEqual({ entries: 2, files: 2, bytes: 3 });
        const b = a.children![1]!;
        expect(b.children).toBeUndefined(); // deeper than the tree depth
        expect(b).toMatchObject({ bytes: 50, files: 1 });
    });

    it('evaluates budgets and turns on the reports they need', async () => {
        const root = await fixture({ a: 'same', b: 'same' });
        const result = await analyze(root, { budgets: ['size<=1k', 'duplicates=0', 'files<10'] });
        expect(result.duplicates?.count).toBe(1);
        expect(result.budgets?.map((b) => b.passed)).toEqual([true, false, true]);
        const more = await analyze(root, { budgets: ['large=0', 'empty=0', 'stale=0'] });
        expect(more.largeFiles).toBeDefined();
        expect(more.emptyFiles).toBeDefined();
        expect(more.staleFiles).toBeDefined();
    });
});

describe('analyze: robustness', () => {
    it.skipIf(isWindows || isRoot)('records unreadable directories and keeps going', async () => {
        const root = await fixture({ 'ok.txt': 'x', 'locked/secret.txt': 'x' });
        await chmod(join(root, 'locked'), 0o000);
        try {
            const result = await analyze(root);
            expect(result.summary.files).toBe(1);
            expect(result.summary.errors).toBe(1);
            expect(result.errors).toEqual([
                { path: 'locked', code: 'EACCES', message: 'permission denied' },
            ]);
        } finally {
            await chmod(join(root, 'locked'), 0o755);
        }
    });

    it('can be aborted', async () => {
        const root = await fixture({});
        for (let i = 0; i < 50; i++) {
            await mkdir(join(root, `d${i}`), { recursive: true });
            await writeFile(join(root, `d${i}`, 'f.txt'), 'x');
        }
        const controller = new AbortController();
        controller.abort();
        await expect(analyze(root, { signal: controller.signal })).rejects.toBeInstanceOf(
            AbortError
        );
        const late = new AbortController();
        const promise = analyze(root, { signal: late.signal, concurrency: 1 });
        late.abort();
        await expect(promise).rejects.toBeInstanceOf(AbortError);
    });

    it('reports scan progress', async () => {
        const root = await fixture({ 'a.txt': 'x', 'b/c.txt': 'y' });
        const seen: number[] = [];
        await analyze(root, {
            onProgress: (p) => p.phase === 'scan' && seen.push(p.files),
            progressInterval: 1,
        });
        expect(seen.at(-1)).toBe(2);
    });

    it('handles an empty directory', async () => {
        const root = await fixture({});
        const result = await analyze(root, { duplicates: true, empty: true, tree: true });
        expect(result.summary).toMatchObject({ files: 0, directories: 0, bytes: 0 });
        expect(result.duplicates?.count).toBe(0);
        expect(result.tree).toMatchObject({ files: 0, bytes: 0 });
    });
});
