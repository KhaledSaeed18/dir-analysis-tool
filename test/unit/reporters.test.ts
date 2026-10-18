import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze.ts';
import { compare } from '../../src/core/compare.ts';
import { createStyle, stripAnsi } from '../../src/format/style.ts';
import { csvCell, renderAnalysisCsv, renderComparisonCsv } from '../../src/reporters/csv.ts';
import { escapeHtml, renderAnalysisHtml } from '../../src/reporters/html.ts';
import { renderAnalysisAs, renderComparisonAs } from '../../src/reporters/index.ts';
import {
    mdCode,
    renderAnalysisMarkdown,
    renderComparisonMarkdown,
} from '../../src/reporters/markdown.ts';
import { renderAnalysis, renderComparison } from '../../src/reporters/pretty.ts';
import { join } from 'node:path';
import { bytes, fixture } from '../helpers/fixture.ts';

async function fullResult() {
    const root = await fixture({
        'src/app.ts': 'x'.repeat(200),
        // Legal on every platform, but each needs escaping in some format.
        "src/a&b's.ts": 'x',
        'assets/a.png': bytes(4000),
        'assets/copy.png': bytes(4000),
        'old/notes.txt': { content: 'n', mtime: '2015-01-01T00:00:00Z' },
        'empty.txt': '',
        hollow: { dir: true },
        'tick`name.md': 'x',
    });
    return analyze(root, {
        largeFiles: '1k',
        duplicates: true,
        empty: true,
        stale: '2y',
        tree: true,
        budgets: ['size<1MB', 'duplicates=0'],
    });
}

describe('pretty', () => {
    it('renders every section without color codes when styling is off', async () => {
        const result = await fullResult();
        const text = renderAnalysis(result, { extensions: true, width: 120 });
        for (const heading of [
            'File types',
            'Extensions',
            'Largest folders',
            'Largest files',
            'Large files ≥ 1 KiB',
            'Duplicates',
            'Empty files',
            'Empty folders',
            'Not modified since',
            'Tree',
            'Budgets',
        ]) {
            expect(text).toContain(heading);
        }
        expect(text).toContain('1 failed');
        expect(text).not.toContain('\u001B[');
        const colored = renderAnalysis(result, { style: createStyle(true) });
        expect(colored).toContain('\u001B[');
        expect(stripAnsi(colored)).toBe(renderAnalysis(result));
    });

    it('can hide the type breakdown and use SI units', async () => {
        const result = await fullResult();
        const text = renderAnalysis(result, { types: false, units: 'si' });
        expect(text).not.toContain('File types');
        expect(text).toContain('kB');
    });

    it('renders comparisons', async () => {
        const root = await fixture({
            'a/x.txt': 'x',
            'a/gone.txt': 'g',
            'b/x.txt': 'xx',
            'b/new.txt': 'n',
        });
        const result = await compare(join(root, 'a'), join(root, 'b'));
        const text = renderComparison(result);
        expect(text).toContain('Added');
        expect(text).toContain('Removed');
        expect(text).toContain('Changed');
        const same = await compare(join(root, 'a'), join(root, 'a'));
        expect(renderComparison(same)).toContain('No differences.');
    });
});

describe('markdown', () => {
    it('escapes table-breaking characters', () => {
        expect(mdCode('a|b')).toBe('`a\\|b`');
        expect(mdCode('a`b')).toBe('`` a`b ``');
    });

    it('renders analyses and comparisons as GFM tables', async () => {
        const result = await fullResult();
        const md = renderAnalysisMarkdown(result);
        expect(md).toMatch(/^## Directory analysis/);
        expect(md).toContain('| Size |');
        expect(md).toContain('### Budgets ❌ 1 failed');
        expect(md).toContain('`` tick`name.md ``');
        const root = await fixture({ 'a/x': 'x', 'b/y': 'yy' });
        const cmp = renderComparisonMarkdown(await compare(join(root, 'a'), join(root, 'b')));
        expect(cmp).toContain('### Added');
        expect(cmp).toContain('### Removed');
    });
});

describe('csv', () => {
    it('quotes cells and blocks formula injection', () => {
        expect(csvCell('plain')).toBe('plain');
        expect(csvCell('a,b')).toBe('"a,b"');
        expect(csvCell('say "hi"')).toBe('"say ""hi"""');
        expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
        expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
        expect(csvCell('+1')).toBe("'+1");
        expect(csvCell(42)).toBe('42');
        expect(csvCell(null)).toBe('');
    });

    it('exports one row per item with a section column', async () => {
        const result = await fullResult();
        const csv = renderAnalysisCsv(result);
        expect(csv.startsWith('﻿section,item,bytes,files,modified,group\r\n')).toBe(true);
        for (const section of [
            'summary',
            'type',
            'extension',
            'largest-file',
            'large-file',
            'duplicate',
            'empty-file',
            'empty-directory',
            'stale-file',
        ]) {
            expect(csv).toContain(`\r\n${section},`);
        }
        const root = await fixture({ 'a/x': 'x', 'b/y': 'y', 'b/x': 'xx' });
        const cmp = renderComparisonCsv(await compare(join(root, 'a'), join(root, 'b')));
        expect(cmp).toContain('added,y,,1,1');
        expect(cmp).toContain('changed,x,1,2,1');
    });
});

describe('html', () => {
    it('is self-contained and escapes paths', async () => {
        const result = await fullResult();
        const html = renderAnalysisHtml(result);
        expect(html).toMatch(/^<!doctype html>/);
        expect(html).toContain("default-src 'none'");
        expect(html).not.toMatch(/<script[^>]+src=/);
        expect(html).not.toMatch(/https?:\/\/(?!github\.com)/);
        expect(html).toContain('a&amp;b&#39;s.ts');
        expect(html).not.toContain("a&b's.ts");
        expect(html).toContain('<svg class="donut"');
        expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
            '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
        );
    });
});

describe('format dispatch', () => {
    it('renders every format for analyses and all but html for comparisons', async () => {
        const result = await fullResult();
        const options = {
            style: createStyle(false),
            units: 'iec' as const,
            width: 100,
            limit: 10,
            types: true,
            extensions: false,
        };
        expect(JSON.parse(renderAnalysisAs('json', result, options))).toEqual(result);
        for (const format of ['pretty', 'markdown', 'csv', 'html'] as const) {
            expect(renderAnalysisAs(format, result, options).length).toBeGreaterThan(100);
        }
        const root = await fixture({ 'a/x': 'x', 'b/x': 'x' });
        const cmp = await compare(join(root, 'a'), join(root, 'b'));
        for (const format of ['pretty', 'json', 'markdown', 'csv'] as const) {
            expect(renderComparisonAs(format, cmp, options).length).toBeGreaterThan(10);
        }
        expect(() => renderComparisonAs('html', cmp, options)).toThrow(/not available/);
    });
});
