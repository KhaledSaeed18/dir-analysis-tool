import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { comparePaths } from '../../src/core/paths.ts';
import { createStyle } from '../../src/format/style.ts';
import { renderAnalysisAs } from '../../src/reporters/index.ts';
import type { TreeNode } from '../../src/types.ts';
import { fixture } from '../helpers/fixture.ts';

// Pairs that locale collation orders differently from code points: '_' and '.', and 'é' and 'f'.
async function ties(): Promise<string> {
    return fixture({
        'img/big.png': { size: 1000 },
        'img/big_copy.png': { size: 1000 },
        'b_x/f': { size: 500 },
        'b.x/f': { size: 500 },
        'x.f': 'z',
        'x.é': 'z',
    });
}

const names = (node: TreeNode | undefined): string[] =>
    node?.children?.map((child) => child.name) ?? [];

describe('equal sizes sort by path in code-point order everywhere (#26)', () => {
    it('in the tree, its files and folders, and the extensions list', async () => {
        const result = await analyze(await ties(), { tree: true });
        const tree = result.tree!;
        const img = tree.children!.find((c) => c.name === 'img');
        expect(names(img)).toEqual(['big.png', 'big_copy.png']);
        expect(names(tree).slice(1, 3)).toEqual(['b.x', 'b_x']);
        expect(names(tree).slice(3)).toEqual(['x.f', 'x.é']);
        const exts = result.extensions.filter((e) => e.files === 1).map((e) => e.extension);
        expect(exts).toEqual(['.f', '.é']);
        expect([...exts].sort(comparePaths)).toEqual(exts);
        // The largest-files list already agreed; the tree now matches it.
        expect(result.largestFiles.slice(0, 2).map((f) => f.path)).toEqual([
            'img/big.png',
            'img/big_copy.png',
        ]);
    });

    // Markdown has no tree; its lists come from the same sorted result.
    it.each([
        ['pretty', ' Tree'],
        ['html', '<div class="tree">'],
    ] as const)('in the %s tree', async (format, marker) => {
        const result = await analyze(await ties(), { tree: true });
        const text = renderAnalysisAs(format, result, {
            style: createStyle(false),
            units: 'iec',
            width: 120,
            limit: 10,
            types: true,
            extensions: true,
        });
        const tree = text.slice(text.indexOf(marker));
        const at = (name: string): number => tree.indexOf(name);
        expect(at('big.png')).toBeGreaterThan(-1);
        expect(at('big.png')).toBeLessThan(at('big_copy.png'));
        expect(at('b.x')).toBeLessThan(at('b_x'));
    });
});
