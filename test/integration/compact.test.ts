import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { compactAnalysis } from '../../src/core/compact.ts';
import type { AnalysisResult } from '../../src/types.ts';
import { cli, json, type CliResult } from '../helpers/cli.ts';
import { fixture, isRoot, isWindows, type Tree } from '../helpers/fixture.ts';

/** `groups` duplicate groups of `copies` files each; group i has size 100 + i, so order is fixed. */
function duplicateTree(groups: number, copies = 2): Tree {
    const tree: Tree = {};
    for (let g = 0; g < groups; g++) {
        const content = String(g)
            .padStart(3, '0')
            .padEnd(100 + g, '.');
        for (let c = 0; c < copies; c++) {
            tree[`g${String(g).padStart(2, '0')}/copy${c}.txt`] = content;
        }
    }
    return tree;
}

function parse(result: CliResult): AnalysisResult {
    if (result.code !== 0) throw new Error(`exit ${result.code}: ${result.stderr}`);
    return json<AnalysisResult>(result);
}

/** Drops the fields that differ between two runs of the same scan. */
function stable(result: AnalysisResult): Omit<AnalysisResult, 'startedAt' | 'durationMs'> {
    const { startedAt: _s, durationMs: _d, ...rest } = result;
    return rest;
}

describe('analyze --compact', () => {
    it('cuts duplicate groups to the limit and keeps full totals', async () => {
        const root = await fixture(duplicateTree(25));
        const full = parse(await cli([root, '-d', '--json', '--no-config']));
        const compact = parse(await cli([root, '-d', '--compact', '--no-config']));

        expect(compact.duplicates?.items).toEqual(full.duplicates?.items.slice(0, 10));
        const { items: _a, ...fullTotals } = full.duplicates!;
        const { items: _b, ...compactTotals } = compact.duplicates!;
        expect(compactTotals).toEqual(fullTotals);
        expect(compact.duplicates?.count).toBe(25);
        expect(compact.compact).toEqual({
            limit: 10,
            truncated: true,
            omitted: { 'duplicates.items': 15 },
        });
        expect(full.compact).toBeUndefined();
    });

    it.each([
        [9, undefined],
        [10, undefined],
        [11, 1],
    ])('discloses a cut only past the limit (%i groups)', async (groups, omitted) => {
        const root = await fixture(duplicateTree(groups));
        const result = parse(await cli([root, '-d', '--compact', '--no-config']));
        expect(result.duplicates?.items).toHaveLength(Math.min(groups, 10));
        expect(result.compact?.omitted['duplicates.items']).toBe(omitted);
        expect(result.compact?.truncated).toBe(omitted !== undefined);
    });

    it('cuts the copies of a large group and keeps its wasted bytes', async () => {
        const root = await fixture(duplicateTree(1, 12));
        const result = parse(await cli([root, '-d', '--compact', '--no-config']));
        const [group] = result.duplicates!.items;
        // The first 10 in path order, as in the full list.
        const all = Array.from({ length: 12 }, (_, i) => `g00/copy${i}.txt`).sort();
        expect(group!.files).toEqual(all.slice(0, 10));
        expect(group!.omittedFiles).toBe(2);
        expect(group!.wastedBytes).toBe(group!.bytes * 11);
        expect(result.duplicates?.files).toBe(12);
        expect(result.compact?.omitted).toEqual({ 'duplicates.items[].files': 2 });
    });

    it('tells empty results from reports that are off', async () => {
        const root = await fixture({ 'a.txt': 'one', 'b.txt': 'two' });
        const on = parse(await cli([root, '-d', '--compact', '--no-config']));
        expect(on.duplicates).toEqual({ count: 0, files: 0, bytes: 0, wastedBytes: 0, items: [] });
        expect(on.compact).toEqual({ limit: 10, truncated: false, omitted: {} });
        const off = parse(await cli([root, '--compact', '--no-config']));
        expect(off.duplicates).toBeUndefined();
        expect(off.largeFiles).toBeUndefined();
        expect(off.staleFiles).toBeUndefined();
    });

    it('keeps --top 0 for the largest lists and cuts the rest to 10', async () => {
        const root = await fixture(duplicateTree(12));
        const result = parse(await cli([root, '-d', '-n', '0', '--compact', '--no-config']));
        expect(result.largestFiles).toEqual([]);
        expect(result.largestDirectories).toEqual([]);
        expect(result.duplicates?.items).toHaveLength(10);
        expect(result.compact?.limit).toBe(10);
    });

    it('cuts every list to --top and discloses each one in document order', async () => {
        const tree: Tree = {};
        for (let i = 0; i < 30; i++) {
            tree[`ext/file.e${String(i).padStart(2, '0')}`] = 'x'.repeat(i + 1);
        }
        for (let i = 0; i < 5; i++) tree[`big/b${i}.bin`] = { size: 2048 + i };
        for (let i = 0; i < 4; i++) tree[`empty/e${i}.txt`] = '';
        for (let i = 0; i < 4; i++) tree[`hollow/h${i}`] = { dir: true };
        for (let i = 0; i < 6; i++) {
            tree[`old/o${i}.txt`] = { content: `o${i}`, mtime: '2001-01-01' };
        }
        const root = await fixture(tree);
        const args = [root, '-n', '3', '-l', '2KiB', '--empty', '--stale', '2010-01-01'];
        const full = parse(await cli([...args, '--json', '--no-config']));
        const result = parse(await cli([...args, '--compact', '--no-config']));

        expect(result.extensions).toEqual(full.extensions.slice(0, 3));
        expect(result.largeFiles?.items).toEqual(full.largeFiles?.items.slice(0, 3));
        expect(result.emptyFiles?.items).toEqual(full.emptyFiles?.items.slice(0, 3));
        expect(result.emptyDirectories?.items).toEqual(full.emptyDirectories?.items.slice(0, 3));
        expect(result.staleFiles?.items).toEqual(full.staleFiles?.items.slice(0, 3));
        expect(result.summary).toEqual(full.summary);
        expect(result.types).toEqual(full.types);
        expect(result.compact?.limit).toBe(3);
        const omitted = result.compact!.omitted;
        expect(omitted).toEqual({
            extensions: full.extensions.length - 3,
            'largeFiles.items': 2,
            'emptyFiles.items': 1,
            'emptyDirectories.items': full.emptyDirectories!.count - 3,
            'staleFiles.items': 3,
        });
        // Keys follow the order of the sections in the result.
        const order = Object.keys(result);
        const sections = Object.keys(omitted).map((k) => order.indexOf(k.split('.')[0]!));
        expect(sections).toEqual([...sections].sort((a, b) => a - b));
    });

    it.skipIf(isWindows || isRoot)(
        'cuts errors and counts them against summary.errors',
        async () => {
            const tree: Tree = { 'ok.txt': 'x' };
            for (let i = 0; i < 150; i++) tree[`locked${String(i).padStart(3, '0')}/f.txt`] = 'x';
            const root = await fixture(tree);
            const locked = Object.keys(tree)
                .filter((p) => p.startsWith('locked'))
                .map((p) => join(root, p.split('/')[0]!));
            await Promise.all(locked.map((dir) => chmod(dir, 0o000)));
            try {
                const result = parse(await cli([root, '--compact', '--no-config']));
                expect(result.summary.errors).toBe(150);
                expect(result.errors).toHaveLength(10);
                expect(result.errors[0]?.path).toBe('locked000');
                expect(result.compact?.omitted).toEqual({ errors: 140 });
            } finally {
                await Promise.all(locked.map((dir) => chmod(dir, 0o755)));
            }
        }
    );

    it.skipIf(isWindows)('keeps exact names and writes no raw control characters', async () => {
        const names = ['evil\u001b[31m.txt', 'invoice\u202etxt.exe', 'new\nline.txt'];
        const tree: Tree = {};
        for (const name of names) tree[name] = 'same contents';
        const root = await fixture(tree);
        const result = await cli([root, '-d', '--compact', '--no-config']);
        expect(result.stdout.includes('\u001b')).toBe(false);
        expect(result.stdout.includes('\u202e')).toBe(false);
        expect(result.stdout.indexOf('\n')).toBe(result.stdout.length - 1);
        const files = parse(result).duplicates?.items[0]?.files;
        expect([...(files ?? [])].sort()).toEqual([...names].sort());
    });

    it('prints one line equal to compactAnalysis of the full result', async () => {
        const root = await fixture(duplicateTree(14, 3));
        const result = await cli([root, '-d', '-x', '-t', '--compact', '--no-config']);
        expect(result.stdout.endsWith('\n')).toBe(true);
        expect(result.stdout.slice(0, -1)).not.toContain('\n');
        const library = compactAnalysis(
            await analyze(root, { duplicates: true, tree: true, defaultExcludes: true }),
            { limit: 10 }
        );
        expect(stable(parse(result))).toEqual(stable(library));
    });

    it('cuts ties by path, the same on every run', async () => {
        const tree: Tree = {};
        for (const name of ['m', 'c', 'x', 'a', 'q', 'b', 'z']) {
            tree[`${name}.bin`] = { size: 4096 };
        }
        const root = await fixture(tree);
        const args = [root, '-l', '1KiB', '-n', '3', '--compact', '--no-config'];
        const first = parse(await cli(args));
        const second = parse(await cli(args));
        expect(first.largeFiles?.items.map((f) => f.path)).toEqual(['a.bin', 'b.bin', 'c.bin']);
        expect(stable(first)).toEqual(stable(second));
    });

    it('refuses other formats and writes to -o', async () => {
        const root = await fixture(duplicateTree(2));
        const markdown = await cli([root, '--compact', '-f', 'markdown', '--no-config']);
        expect(markdown.code).toBe(1);
        expect(markdown.stderr).toContain('--compact prints JSON; remove --format markdown.');
        expect(
            parse(await cli([root, '--compact', '-f', 'json', '--no-config'])).compact
        ).toBeDefined();

        const out = join(root, 'report.json');
        const written = await cli([root, '-d', '--compact', '-o', out, '-q', '--no-config']);
        expect(written.code).toBe(0);
        expect(written.stdout).toBe('');
        const text = await readFile(out, 'utf8');
        expect(text.trimEnd()).not.toContain('\n');
        expect((JSON.parse(text) as AnalysisResult).compact?.limit).toBe(10);
    });

    it('keeps budgets and their exit code', async () => {
        const root = await fixture(duplicateTree(12));
        const result = await cli([
            root,
            '--compact',
            '-n',
            '1',
            '-b',
            'duplicates=0',
            '-b',
            'files<1000',
            '--no-config',
        ]);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('budget failed duplicates=0');
        const parsed = json<AnalysisResult>(result);
        expect(parsed.budgets?.map((b) => b.passed)).toEqual([false, true]);
    });

    it('leaves the default JSON unchanged', async () => {
        const root = await fixture(duplicateTree(12));
        const result = await cli([root, '-d', '--json', '--no-config']);
        expect(result.stdout.split('\n').length).toBeGreaterThan(10);
        expect(result.stdout).not.toContain('"compact"');
        expect(json<AnalysisResult>(result).duplicates?.items).toHaveLength(12);
    });
});
