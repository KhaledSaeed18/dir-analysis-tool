import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { BUDGET_METRICS } from '../../src/core/budgets.ts';
import { compactAnalysis } from '../../src/core/compact.ts';
import { compare } from '../../src/core/compare.ts';
import { EXPLAIN_VERSION, explainPath, explainSkips } from '../../src/core/explain.ts';
import { CATEGORIES } from '../../src/types.ts';
import { cli, json } from '../helpers/cli.ts';
import { bytes, fixture, isWindows, type Tree } from '../helpers/fixture.ts';
import { assertValidReport, REPORT_SCHEMA, undeclared } from '../helpers/report-schema.ts';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    files: string[];
    exports: Record<string, unknown>;
};

const OLD = '2020-01-01T00:00:00Z';

/** A tree that turns on every optional section of a report. */
const TREE: Tree = {
    '.gitignore': 'build/\n*.log\n',
    'src/a.ts': bytes(4000, 1),
    'src/b.ts': bytes(3000, 2),
    'assets/logo.png': bytes(9000, 3),
    'assets/copy/logo.png': bytes(9000, 3),
    'docs/old.md': { content: 'old notes', mtime: OLD },
    'docs/empty.txt': '',
    'empty-folder': { dir: true },
    'build/out.js': bytes(500, 4),
    'debug.log': 'log',
    'big.bin': bytes(20_000, 5),
};

function enumOf(name: string, field: string): unknown {
    return REPORT_SCHEMA.$defs[name]?.properties?.[field]?.enum;
}

describe('report.schema.json', () => {
    it('ships in the package, importable as dir-analysis-tool/report.schema.json', () => {
        expect(pkg.files).toContain('report.schema.json');
        expect(pkg.exports['./report.schema.json']).toBe('./report.schema.json');
    });

    it('lists every file type category and budget metric the code knows', () => {
        expect(REPORT_SCHEMA.$defs['types']?.required).toEqual([...CATEGORIES]);
        expect(enumOf('budgetResult', 'metric')).toEqual(Object.keys(BUDGET_METRICS));
    });

    it('carries the report versions the code writes', () => {
        expect(REPORT_SCHEMA.$defs['analysis']?.properties?.['schemaVersion']).toEqual({
            const: 3,
        });
        expect(REPORT_SCHEMA.$defs['comparison']?.properties?.['schemaVersion']).toEqual({
            const: 3,
        });
        for (const kind of ['pathExplanation', 'skipsExplanation']) {
            expect(REPORT_SCHEMA.$defs[kind]?.properties?.['explainVersion']).toEqual({
                const: EXPLAIN_VERSION,
            });
        }
    });

    it('catches a field it does not declare, at any depth', () => {
        const report = { summary: { bytes: 1, surprise: true }, extra: 1 };
        expect(undeclared(report, REPORT_SCHEMA.$defs['analysis'] ?? {})).toEqual([
            '$.summary.surprise',
            '$.extra',
        ]);
    });
});

describe('every report matches report.schema.json', () => {
    it('analyze, with every optional section on', async () => {
        const root = await fixture(TREE);
        const report = json(
            await cli([
                root,
                '--json',
                '-g',
                '-d',
                '-x',
                '-t',
                '--empty',
                '--stale',
                '1y',
                '-l',
                '10kB',
                '-b',
                'size<=1GB',
                '-b',
                'duplicates=0',
            ])
        );
        expect(Object.keys(report)).toEqual(
            expect.arrayContaining([
                'largeFiles',
                'duplicates',
                'emptyFiles',
                'emptyDirectories',
                'staleFiles',
                'tree',
                'budgets',
            ])
        );
    });

    it('compact output, with lists cut', async () => {
        const root = await fixture(TREE);
        const report = json(await cli([root, '-d', '-x', '--empty', '--compact', '-n', '1']));
        expect(report).toHaveProperty('compact.truncated', true);
    });

    it('compare, by size and by content', async () => {
        const left = await fixture({ 'a.txt': 'one', 'same.txt': 'same', 'gone.txt': 'x' });
        const right = await fixture({ 'a.txt': 'one!', 'same.txt': 'same', 'new.txt': 'y' });
        for (const mode of [[], ['--content']]) {
            const report = json(await cli(['compare', left, right, '--json', ...mode]));
            expect(report).toHaveProperty('mode', mode.length > 0 ? 'content' : 'size');
        }
    });

    it('explain, for one path and for every skip', async () => {
        const root = await fixture(TREE);
        const decisions = new Set<unknown>();
        const explain = async (args: string[]): Promise<void> => {
            decisions.add(
                json(await cli(['explain', ...args, '--json'], { cwd: root }))['decision']
            );
        };
        for (const path of ['build/out.js', 'debug.log', 'src/a.ts', 'missing.txt', '.']) {
            await explain([path, '-g']);
        }
        await explain(['big.bin', '--max-size', '1kB']);
        await explain(['docs/old.md', '--older-than', '1y']);
        expect([...decisions].map(String).toSorted((a, b) => a.localeCompare(b))).toEqual([
            'excluded',
            'filtered',
            'included',
            'not-found',
        ]);
        const skips = json(await cli(['explain', '-g', '-e', 'docs/', '--json'], { cwd: root }));
        expect(skips).toHaveProperty('groups');
    });

    it.skipIf(isWindows)('explain, with symbolic links and a depth limit', async () => {
        const root = await fixture({ ...TREE, 'deep/a/b/c.txt': 'c', link: { symlink: 'src' } });
        const skips = json(await cli(['explain', '--max-depth', '1', '--json'], { cwd: root }));
        expect(skips).toHaveProperty('totals.depthSkipped');
        expect(JSON.stringify(skips)).toContain('"max-depth"');
        const link = json(await cli(['explain', 'link', '--json'], { cwd: root }));
        expect(link).toHaveProperty('reason.source', 'symlink');
        const deep = json(
            await cli(['explain', 'deep/a/b/c.txt', '--max-depth', '1', '--json'], { cwd: root })
        );
        expect(deep).toHaveProperty('reason.source', 'max-depth');
    });

    it('the library returns the same shapes', async () => {
        const root = await fixture(TREE);
        const result = await analyze(root, { duplicates: true, empty: true, tree: true });
        assertValidReport(JSON.parse(JSON.stringify(result)));
        assertValidReport(JSON.parse(JSON.stringify(compactAnalysis(result, { limit: 1 }))));
        assertValidReport(JSON.parse(JSON.stringify(await compare(root, root))));
        assertValidReport(JSON.parse(JSON.stringify(await explainPath(root, 'src/a.ts'))));
        assertValidReport(
            JSON.parse(JSON.stringify(await explainSkips(root, { gitignore: true })))
        );
        expect(result.duplicates?.count).toBe(1);
    });
});
