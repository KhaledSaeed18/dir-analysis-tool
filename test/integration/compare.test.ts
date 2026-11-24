import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compare } from '../../src/core/compare.ts';
import type { ComparisonResult } from '../../src/types.ts';
import { cli, json } from '../helpers/cli.ts';
import { bytes, fixture } from '../helpers/fixture.ts';

describe('compare', () => {
    it('reports added, removed, and changed files and size deltas', async () => {
        const root = await fixture({
            'left/same.txt': 'same',
            'left/grows.txt': 'ab',
            'left/gone/old.bin': bytes(100),
            'left/assets/img/a.png': bytes(10),
            'right/same.txt': 'same',
            'right/grows.txt': 'abcdef',
            'right/new.txt': 'n',
            'right/assets/img/a.png': bytes(10),
            'right/assets/img/b.png': bytes(1000),
        });
        const result = await compare(join(root, 'left'), join(root, 'right'));
        expect(result.mode).toBe('size');
        expect(result.added.items.map((f) => f.path)).toEqual(['assets/img/b.png', 'new.txt']);
        expect(result.added).toMatchObject({ count: 2, bytes: 1001 });
        expect(result.removed).toMatchObject({ count: 1, bytes: 100 });
        expect(result.removed.items[0]!.path).toBe('gone/old.bin');
        expect(result.changed).toEqual({
            count: 1,
            delta: 4,
            items: [{ path: 'grows.txt', leftBytes: 2, rightBytes: 6, delta: 4 }],
        });
        expect(result.unchanged).toBe(2);
        expect(result.delta).toMatchObject({ bytes: 1001 + 4 - 100, files: 1, directories: -1 });
        expect(result.left.types.images.files).toBe(1);
        expect(result.right.types.images.files).toBe(2);
        // "assets" only passes through to "assets/img", so it is folded.
        expect(result.directories.map((d) => [d.path, d.delta])).toEqual([
            ['assets/img', 1000],
            ['gone', -100],
        ]);
    });

    it('detects same-size content changes in content mode', async () => {
        const root = await fixture({
            'a/f.txt': 'abc',
            'a/g.txt': 'xyz',
            'a/e': '',
            'b/f.txt': 'abd',
            'b/g.txt': 'xyz',
            'b/e': '',
        });
        const bySize = await compare(join(root, 'a'), join(root, 'b'));
        expect(bySize.changed.count).toBe(0);
        const progress: string[] = [];
        const byContent = await compare(join(root, 'a'), join(root, 'b'), {
            content: true,
            onProgress: (p) => progress.push(p.phase),
        });
        expect(byContent.mode).toBe('content');
        expect(byContent.changed.items).toEqual([
            { path: 'f.txt', leftBytes: 3, rightBytes: 3, delta: 0 },
        ]);
        expect(byContent.unchanged).toBe(2);
        expect(progress).toContain('hash');
    });

    it('finds no differences between identical trees and validates options', async () => {
        const root = await fixture({ 'a/x': 'x', 'b/x': 'x' });
        const result = await compare(join(root, 'a'), join(root, 'b'), { top: 0 });
        expect(result.added.count + result.removed.count + result.changed.count).toBe(0);
        expect(result.directories).toEqual([]);
        await expect(compare(join(root, 'a'), join(root, 'b'), { top: -1 })).rejects.toThrow(/top/);
        await expect(compare(join(root, 'a'), join(root, 'missing'))).rejects.toThrow(
            /No such directory/
        );
    });
});

describe('dat compare --top (#21)', () => {
    async function trees(): Promise<[string, string]> {
        const left = await fixture(
            Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}.txt`, 'x']))
        );
        const right = await fixture({
            ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}.txt`, 'xx'])),
            ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`d${i}/f`, 'y'])),
        });
        return [left, right];
    }

    it('hides every list with -n 0 in pretty and Markdown, keeping the counts', async () => {
        const [left, right] = await trees();
        const pretty = await cli(['compare', left, right, '-n', '0', '--no-config']);
        expect(pretty.code).toBe(0);
        expect(pretty.stdout).toContain('Added  15 files');
        expect(pretty.stdout).toContain('… 15 files not listed (--top 0)');
        expect(pretty.stdout).toContain('… 12 files not listed (--top 0)');
        expect(pretty.stdout).not.toMatch(/^ {3}[+~] /m);
        expect(pretty.stdout).not.toContain('Folders that changed most');

        const md = await cli(['compare', left, right, '-n', '0', '-f', 'markdown', '--no-config']);
        expect(md.stdout).toContain('### Added: 15 files');
        expect(md.stdout).toContain('<sub>15 files not listed (--top 0)</sub>');
        expect(md.stdout).not.toContain('`d0/f`');
        expect(md.stdout).not.toContain('`c0.txt`');
    });

    it('cuts every list to -n in pretty output', async () => {
        const [left, right] = await trees();
        const pretty = await cli(['compare', left, right, '-n', '3', '--no-config']);
        expect(pretty.stdout.match(/^ {3}\+ /gm)).toHaveLength(3);
        expect(pretty.stdout.match(/^ {3}~ /gm)).toHaveLength(3);
        expect(pretty.stdout).toContain('… 12 more');
    });

    it('keeps JSON file lists complete; folders follow --top', async () => {
        const [left, right] = await trees();
        for (const [top, folders] of [
            ['0', 0],
            ['3', 3],
        ] as const) {
            const report = json<ComparisonResult>(
                await cli(['compare', left, right, '-n', top, '-j', '--no-config'])
            );
            expect(report.added.items).toHaveLength(15);
            expect(report.changed.items).toHaveLength(12);
            expect(report.directories).toHaveLength(folders);
        }
    });
});
