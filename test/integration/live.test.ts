import {
    appendFile,
    chmod,
    link,
    mkdir,
    rename,
    rm,
    symlink,
    utimes,
    writeFile,
} from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, type AnalyzeOptions } from '../../src/core/analyze.ts';
import { addError, LiveAnalysis } from '../../src/core/live.ts';
import { MAX_ERROR_DETAILS } from '../../src/core/scanner.ts';
import type { AnalysisResult } from '../../src/types.ts';
import { fixture, isRoot, isWindows } from '../helpers/fixture.ts';

/** The report without the fields that differ between any two runs. */
function comparable(result: AnalysisResult): unknown {
    const { durationMs: _d, startedAt: _s, ...rest } = result;
    return rest;
}

async function expectSameAsFullScan(
    root: string,
    options: AnalyzeOptions,
    result: AnalysisResult
): Promise<void> {
    expect(comparable(result)).toEqual(comparable(await analyze(root, options)));
}

async function start(root: string, options: AnalyzeOptions): Promise<LiveAnalysis> {
    const created = await LiveAnalysis.create(root, options);
    expect(created).not.toBeNull();
    await expectSameAsFullScan(root, options, created!.update.result);
    return created!.live;
}

/** A small seeded generator, so a failing round reproduces. */
function random(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Names that sort around '/', plus an extension or two, so ties and orders are exercised.
const NAMES = ['a', 'a-b', 'a.b', 'b', 'c.txt', 'd.log', 'e.png', 'Z', 'f.js'];
const CONTENTS = ['', 'x', 'xx', 'same', 'same', 'other!', 'y'.repeat(300), 'z'.repeat(300)];
const OLD = new Date('2015-06-01T00:00:00Z');

function walk(root: string, rel = ''): { files: string[]; dirs: string[] } {
    const out = { files: [] as string[], dirs: [] as string[] };
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.dirs.push(path);
            const inner = walk(root, path);
            out.files.push(...inner.files);
            out.dirs.push(...inner.dirs);
        } else {
            out.files.push(path);
        }
    }
    return out;
}

/** One random change; returns the paths a watcher would report for it. */
async function mutate(root: string, next: () => number): Promise<string[]> {
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
    const { files, dirs } = walk(root);
    const someDir = (): string => (next() < 0.25 ? '' : (pick(dirs) ?? ''));
    const at = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
    const kind = pick([
        'add',
        'add',
        'add-nested',
        'remove',
        'resize',
        'rewrite',
        'age',
        'remove-dir',
        'rename-dir',
        'empty-dir',
    ]);
    switch (kind) {
        case 'add':
        case 'rewrite': {
            const path =
                kind === 'rewrite' && files.length > 0 ? pick(files) : at(someDir(), pick(NAMES));
            if (statSync(join(root, path), { throwIfNoEntry: false })?.isDirectory()) return [];
            await writeFile(join(root, path), pick(CONTENTS));
            return [path];
        }
        case 'add-nested': {
            const dir = at(someDir(), `n${Math.floor(next() * 5)}`);
            if (statSync(join(root, dir), { throwIfNoEntry: false })?.isFile()) return [];
            await mkdir(join(root, dir, 'deep'), { recursive: true });
            await writeFile(join(root, dir, 'deep', pick(NAMES)), pick(CONTENTS));
            return [dir];
        }
        case 'remove':
        case 'resize':
        case 'age': {
            if (files.length === 0) return [];
            const path = pick(files);
            if (kind === 'remove') await rm(join(root, path));
            else if (kind === 'resize') await appendFile(join(root, path), 'more');
            else await utimes(join(root, path), OLD, OLD);
            return [path];
        }
        case 'remove-dir':
        case 'rename-dir': {
            if (dirs.length === 0) return [];
            const dir = pick(dirs);
            if (kind === 'remove-dir') {
                await rm(join(root, dir), { recursive: true });
                return [dir];
            }
            const target = `${dir}-moved${Math.floor(next() * 100)}`;
            if (statSync(join(root, target), { throwIfNoEntry: false })) return [];
            await rename(join(root, dir), join(root, target));
            return [dir, target];
        }
        default: {
            const dir = at(someDir(), `empty${Math.floor(next() * 3)}`);
            if (statSync(join(root, dir), { throwIfNoEntry: false })) return [];
            await mkdir(join(root, dir));
            return [dir];
        }
    }
}

async function seedTree(): Promise<string> {
    const tree: Record<string, string | { content: string; mtime: Date } | { dir: true }> = {};
    for (const dir of ['', 'a', 'a/b', 'a-b', 'a.b', 'a/b/c', 'zz']) {
        // Files whose names never clash with the seeded folders.
        for (const name of NAMES.slice(4)) {
            tree[dir ? `${dir}/${name}` : name] = 'seed '.repeat(NAMES.indexOf(name) + dir.length);
        }
    }
    tree['old.txt'] = { content: 'ancient', mtime: OLD };
    tree['node_modules/dep.js'] = 'x';
    tree['logs/x.log'] = 'log';
    tree['vacant'] = { dir: true };
    return fixture(tree);
}

const OPTION_SETS: Array<[string, AnalyzeOptions]> = [
    ['defaults', {}],
    [
        'every report',
        {
            top: 3,
            tree: { depth: 2, limit: 3 },
            empty: true,
            largeFiles: 100,
            stale: '2016-01-01',
            duplicates: true,
            budgets: ['files<=1000', 'duplicates<=1'],
        },
    ],
    ['excludes and filters', { exclude: ['*.log', 'a.b/'], minSize: 2, defaultExcludes: false }],
    ['depth limit', { maxDepth: 1, top: 50 }],
];

describe('LiveAnalysis (#34)', () => {
    it.each(OPTION_SETS)(
        'matches a full scan after every random change: %s',
        async (_, options) => {
            const root = await seedTree();
            const live = await start(root, options);
            const next = random(34);
            let incremental = 0;
            for (let round = 0; round < 30; round++) {
                const paths: string[] = [];
                for (let i = 0; i < 1 + Math.floor(next() * 3); i++) {
                    paths.push(...(await mutate(root, next)));
                }
                const update = await live.update(paths);
                if (update.mode === 'incremental') incremental++;
                await expectSameAsFullScan(root, options, update.result);
            }
            expect(incremental).toBeGreaterThan(20);
        }
    );

    it('honors .gitignore and scans in full when one changes', async () => {
        const root = await fixture({
            '.git/HEAD': 'ref',
            '.gitignore': '*.tmp\nbuild/\n',
            'a/.gitignore': '!keep.tmp\n',
            'a/keep.tmp': 'k',
            'a/drop.tmp': 'd',
            'build/out.js': 'o',
            'src/x.js': 'x',
        });
        const options: AnalyzeOptions = { gitignore: true, top: 20 };
        const live = await start(root, options);
        await writeFile(join(root, 'src/y.tmp'), 'ignored');
        const ignored = await live.update(['src/y.tmp']);
        expect(ignored.mode).toBe('incremental');
        await expectSameAsFullScan(root, options, ignored.result);

        await writeFile(join(root, 'a/.gitignore'), '');
        const changed = await live.update(['a/.gitignore']);
        expect(changed.mode).toBe('full');
        await expectSameAsFullScan(root, options, changed.result);
    });

    it('re-reads only the folders a change touched', async () => {
        const root = await seedTree();
        const live = await start(root, {});
        await writeFile(join(root, 'a/b/c/new.txt'), 'new');
        const update = await live.update(['a/b/c/new.txt']);
        expect(update).toMatchObject({ mode: 'incremental', folders: 1 });
        await expectSameAsFullScan(root, {}, update.result);
    });

    it('counts hard links once, under the link whose path sorts first', async () => {
        const root = await fixture({ 'z/data.bin': 'x'.repeat(500), 'other.txt': 'o' });
        await mkdir(join(root, 'a'));
        await link(join(root, 'z/data.bin'), join(root, 'a/data.bin'));
        const live = await start(root, { top: 5 }).catch(() => null);
        // The full scan may pick either link; the live analysis always picks a/data.bin.
        const created = await LiveAnalysis.create(root, { top: 5 });
        const full = await analyze(root, { top: 5 });
        expect(created!.update.result.summary).toEqual(full.summary);
        expect(created!.update.result.largestFiles[0]!.path).toBe('a/data.bin');
        expect(live).not.toBeUndefined();

        await rm(join(root, 'a/data.bin'));
        const update = await created!.live.update(['a/data.bin']);
        await expectSameAsFullScan(root, { top: 5 }, update.result);
        expect(update.result.largestFiles[0]!.path).toBe('z/data.bin');
    });

    it.skipIf(isWindows || isRoot)(
        'reports a folder it cannot read, like a full scan',
        async () => {
            const root = await seedTree();
            const live = await start(root, {});
            await chmod(join(root, 'a/b'), 0o000);
            try {
                const update = await live.update(['a/b']);
                await expectSameAsFullScan(root, {}, update.result);
                expect(update.result.summary.errors).toBe(1);
            } finally {
                await chmod(join(root, 'a/b'), 0o755);
            }
            const back = await live.update(['a/b']);
            await expectSameAsFullScan(root, {}, back.result);
        }
    );

    it('re-hashes a duplicate that changed without changing size', async () => {
        const root = await fixture({
            'a/one.txt': 'same',
            'b/two.txt': 'same',
            'c/three.txt': 'diff',
        });
        const options: AnalyzeOptions = { duplicates: true };
        const live = await start(root, options);
        await writeFile(join(root, 'c/three.txt'), 'same');
        const joined = await live.update(['c/three.txt']);
        expect(joined.result.duplicates!.items[0]!.files).toHaveLength(3);
        await expectSameAsFullScan(root, options, joined.result);
        await writeFile(join(root, 'a/one.txt'), 'diff');
        const left = await live.update(['a/one.txt']);
        expect(left.result.duplicates!.items[0]!.files).toEqual(['b/two.txt', 'c/three.txt']);
        await expectSameAsFullScan(root, options, left.result);
    });

    it.skipIf(isWindows)('sees a folder replaced by a symlink to another folder', async () => {
        const root = await seedTree();
        const live = await start(root, {});
        await rm(join(root, 'zz'), { recursive: true });
        await symlink('a', join(root, 'zz'));
        // Re-reading zz alone would follow the link; its parent's listing shows what it is now.
        const update = await live.update(['zz']);
        await expectSameAsFullScan(root, {}, update.result);
        expect(update.result.summary.symlinks).toBe(1);
    });

    it('lists its folders, and reports progress while it scans', async () => {
        const root = await seedTree();
        const phases: string[] = [];
        const created = await LiveAnalysis.create(root, {
            onProgress: (p) => phases.push(p.phase),
            progressInterval: 1,
        });
        expect(created!.live.directories).toEqual(
            expect.arrayContaining(['', 'a', 'a/b', 'a/b/c', 'vacant'])
        );
        expect(created!.live.directories).not.toContain('node_modules');
        expect(phases).toContain('scan');
    });

    it('scans in full when a change touches too many folders', async () => {
        const tree: Record<string, string> = {};
        for (let i = 0; i < 40; i++) tree[`d${i}/f.txt`] = 'x';
        const root = await fixture(tree);
        const live = await start(root, {});
        const paths: string[] = [];
        for (let i = 0; i < 40; i++) {
            await writeFile(join(root, `d${i}/f.txt`), 'xx');
            paths.push(`d${i}/f.txt`);
        }
        const update = await live.update(paths);
        expect(update.mode).toBe('full');
        await expectSameAsFullScan(root, {}, update.result);
    });

    it('notices a folder that vanished when only a path inside it was reported', async () => {
        const root = await seedTree();
        const live = await start(root, {});
        await rm(join(root, 'a/b'), { recursive: true });
        const update = await live.update(['a/b/c/c.txt']);
        expect(update.mode).toBe('incremental');
        await expectSameAsFullScan(root, {}, update.result);
    });

    it('filters a hard-linked file once, by the link that counts', async () => {
        const root = await fixture({ 'a/small.txt': 'x', 'big.txt': 'y'.repeat(100) });
        await link(join(root, 'a/small.txt'), join(root, 'b-small.txt'));
        const options: AnalyzeOptions = { minSize: 10 };
        const created = await LiveAnalysis.create(root, options);
        const full = await analyze(root, options);
        expect(created!.update.result.summary).toEqual(full.summary);
        expect(full.summary).toMatchObject({ filtered: 1, hardlinks: 1, files: 1 });
    });

    it.skipIf(isWindows || isRoot)('counts a duplicate it cannot read as an error', async () => {
        const root = await fixture({ 'a.txt': 'same', 'b.txt': 'same', 'c.txt': 'same' });
        await chmod(join(root, 'c.txt'), 0o000);
        try {
            const options: AnalyzeOptions = { duplicates: true };
            const live = await start(root, options);
            await writeFile(join(root, 'b.txt'), 'diff');
            const update = await live.update(['b.txt']);
            expect(update.result.summary.errors).toBe(1);
            await expectSameAsFullScan(root, options, update.result);
        } finally {
            await chmod(join(root, 'c.txt'), 0o644);
        }
    });

    it('keeps the first error details by path, and counts them all', () => {
        const folder = { errorCount: 0, errors: null as Parameters<typeof addError>[0]['errors'] };
        const total = MAX_ERROR_DETAILS + 5;
        for (let i = total; i > 0; i--) {
            addError(folder, { path: `f${String(i).padStart(3, '0')}`, code: 'EIO', message: 'x' });
        }
        expect(folder.errorCount).toBe(total);
        expect(folder.errors).toHaveLength(MAX_ERROR_DETAILS);
        expect(folder.errors!.map((e) => e.path).sort()[0]).toBe('f001');
        expect(folder.errors!.some((e) => e.path === `f${total}`)).toBe(false);
    });

    it('scans in full when a change names too many paths', async () => {
        const root = await seedTree();
        const live = await start(root, {});
        const paths = Array.from({ length: 1001 }, (_, i) => `a/missing-${i}`);
        expect((await live.update(paths)).mode).toBe('full');
    });

    it.each([
        ['following symlinks', { followSymlinks: true }],
        ['a relative stale age', { stale: '1y' }],
        ['a relative date filter', { modifiedAfter: '30d' }],
    ] as Array<[string, AnalyzeOptions]>)('is not used with %s', async (_, options) => {
        const root = await fixture({ 'a.txt': 'a' });
        expect(await LiveAnalysis.create(root, options)).toBeNull();
    });

    it('is used with absolute dates', async () => {
        const root = await fixture({ 'a.txt': 'a' });
        expect(await LiveAnalysis.create(root, { stale: '2020-01-01' })).not.toBeNull();
    });
});
