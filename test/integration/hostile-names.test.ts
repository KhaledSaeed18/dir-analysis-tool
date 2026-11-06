import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { compare } from '../../src/core/compare.ts';
import { createStyle } from '../../src/format/style.ts';
import { escapeControlInLines, escapeControlKeepingWhitespace } from '../../src/format/text.ts';
import { renderAnalysisAs, renderComparisonAs } from '../../src/reporters/index.ts';
import { fixture, isWindows } from '../helpers/fixture.ts';
import { cli } from '../helpers/cli.ts';

const ESC = '\u001b';
const COLOR = `evil${ESC}[31m.txt`;
const TITLE = `title${ESC}]0;pwned\u0007.log`;
const NEWLINE = 'new\nline.txt';
const BIDI = 'invoice\u202etxt.exe';
const C1 = 'c1\u009b31m.txt';
const EXTENSION = `file.b${ESC}n`;
const FOLDER = `dir${ESC}[2J`;
const NAMES = [COLOR, TITLE, NEWLINE, BIDI, C1, EXTENSION];

const options = {
    style: createStyle(false),
    units: 'iec',
    width: 200,
    limit: 50,
    types: true,
    extensions: true,
} as const;

async function hostileTree(): Promise<string> {
    return fixture({
        ...Object.fromEntries(NAMES.map((name) => [name, 'same content'])),
        [`${FOLDER}/inside.txt`]: 'x',
        [`empty${ESC}[1m`]: '',
        [`hollow${ESC}[1m`]: { dir: true },
    });
}

async function fullAnalysis(root: string) {
    return analyze(root, {
        largeFiles: '1',
        duplicates: true,
        empty: true,
        stale: '0s',
        tree: true,
    });
}

// Windows does not allow these characters in file names.
describe.skipIf(isWindows)('file names with control characters', () => {
    it.each(['pretty', 'markdown'] as const)(
        'are escaped in %s analysis reports',
        async (format) => {
            const root = await hostileTree();
            const text = renderAnalysisAs(format, await fullAnalysis(root), options);
            expect(escapeControlInLines(text)).toBe(text);
            expect(text).toContain('evil\\x1b[31m.txt');
            expect(text).toContain('new\\nline.txt');
            expect(text).toContain('invoice\\u202etxt.exe');
            expect(text).toContain('dir\\x1b[2J');
        }
    );

    it('cannot forge a report line', async () => {
        const root = await fixture({ 'a\n   999 GiB  forged.bin': 'x' });
        const text = renderAnalysisAs('pretty', await fullAnalysis(root), options);
        expect(text.split('\n').filter((line) => line.startsWith('   999 GiB'))).toEqual([]);
    });

    it('are escaped in CSV, apart from the whitespace it quotes', async () => {
        const root = await hostileTree();
        const text = renderAnalysisAs('csv', await fullAnalysis(root), options);
        expect(escapeControlKeepingWhitespace(text)).toBe(text);
        expect(text).toContain('evil\\x1b[31m.txt');
        expect(text).toContain('"new\nline.txt"');
    });

    it('stay exact in JSON, written without raw control characters', async () => {
        const root = await hostileTree();
        const result = await fullAnalysis(root);
        const text = renderAnalysisAs('json', result, options);
        expect(escapeControlInLines(text)).toBe(text);
        const parsed = JSON.parse(text) as typeof result;
        const paths = parsed.largestFiles.map((file) => file.path);
        for (const name of NAMES) expect(paths).toContain(name);
    });

    it.each(['pretty', 'markdown'] as const)('are escaped in %s comparisons', async (format) => {
        const left = await fixture({ [`gone${ESC}[1m`]: 'x', [`both${ESC}[2m`]: 'x' });
        const right = await fixture({ [`new${ESC}[3m`]: 'x', [`both${ESC}[2m`]: 'changed' });
        const result = await compare(left, right, { top: 10 });
        const text = renderComparisonAs(format, result, options);
        expect(escapeControlInLines(text)).toBe(text);
        expect(text).toContain('gone\\x1b[1m');
        expect(text).toContain('new\\x1b[3m');
        expect(text).toContain('both\\x1b[2m');
    });

    it('are escaped by the CLI, in reports and in errors', async () => {
        const root = await hostileTree();
        const report = await cli([root, '--no-config', '-x', '--no-color', '-n', '20']);
        expect(report.code).toBe(0);
        expect(escapeControlInLines(report.stdout)).toBe(report.stdout);

        const missing = await cli([join(root, `missing${ESC}[31m`), '--no-config', '--no-color']);
        expect(missing.code).toBe(1);
        expect(missing.stderr).toContain('missing\\x1b[31m');
        expect(missing.stderr).not.toContain(ESC);
    });

    it('are escaped when config warnings quote an untrusted config file', async () => {
        const root = await fixture({
            '.dir-analyzer.json': JSON.stringify({ [`bad${ESC}[31mkey`]: 1 }),
        });
        const result = await cli([root, '--json']);
        expect(result.stderr).toContain('bad\\x1b[31mkey');
        expect(result.stderr).not.toContain(ESC);
    });

    it('are escaped when reporting where a file was written', async () => {
        const root = await fixture({ [`dir${ESC}[1m/keep`]: 'x' });
        const cwd = join(root, `dir${ESC}[1m`);
        const report = await cli([cwd, '--no-config', '-o', join(cwd, `out${ESC}.txt`)]);
        expect(report.code).toBe(0);
        expect(report.stderr).toContain('written');
        expect(report.stderr).not.toContain(ESC);

        const compared = await cli(['compare', cwd, cwd, '--no-config', '-o', join(cwd, 'c.txt')], {
            cwd,
        });
        expect(compared.code).toBe(0);
        expect(compared.stderr).toContain('written');
        expect(compared.stderr).not.toContain(ESC);

        const init = await cli(['init', '--yes'], { cwd });
        expect(init.code).toBe(0);
        expect(init.stderr).toContain('Wrote');
        expect(init.stderr).not.toContain(ESC);
    });

    it('are escaped when the argument parser quotes bad input', async () => {
        for (const args of [
            ['.', `--nope${ESC}`],
            ['.', '--min-size', `x${ESC}`],
        ]) {
            const result = await cli(args);
            expect(result.code).toBe(1);
            expect(result.stderr).not.toContain(ESC);
        }
    });
});
