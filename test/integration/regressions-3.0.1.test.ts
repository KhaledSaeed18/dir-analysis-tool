/**
 * Regressions found by exercising the published 3.0.0 end to end.
 * Each test names the problem it guards against.
 */
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeArgv } from '../../src/cli/argv.ts';
import { analyze } from '../../src/core/analyze.ts';
import { formatBudgetActual, parseBudget } from '../../src/core/budgets.ts';
import { compare } from '../../src/core/compare.ts';
import { unitsOf } from '../../src/format/bytes.ts';
import { renderAnalysisHtml } from '../../src/reporters/html.ts';
import { renderAnalysisMarkdown } from '../../src/reporters/markdown.ts';
import { renderAnalysis, renderComparison } from '../../src/reporters/pretty.ts';
import { cli } from '../helpers/cli.ts';
import { bytes, fixture, isRoot, isWindows } from '../helpers/fixture.ts';

describe('3.0.1 regressions', () => {
    it.skipIf(isWindows || isRoot)('does not list an unreadable folder as empty', async () => {
        const root = await fixture({ 'locked/secret.txt': 'x', hollow: { dir: true } });
        await chmod(join(root, 'locked'), 0o000);
        try {
            const result = await analyze(root, { empty: true });
            expect(result.emptyDirectories?.items).toEqual(['hollow']);
            expect(result.summary.errors).toBe(1);
        } finally {
            await chmod(join(root, 'locked'), 0o755);
        }
    });

    it('shows thresholds and budget values in the unit system they were written in', async () => {
        expect(unitsOf(1_000_000, 'iec')).toBe('si');
        expect(unitsOf(1_048_576, 'si')).toBe('iec');
        expect(unitsOf(1_024_000, 'iec')).toBe('iec'); // ambiguous: keep the default
        expect(unitsOf(0, 'si')).toBe('si');

        const root = await fixture({ 'big.bin': bytes(1_500_000) });
        const result = await analyze(root, {
            largeFiles: '1MB',
            budgets: ['largest<=12MB', 'files<10'],
        });
        expect(renderAnalysis(result)).toContain('Large files ≥ 1 MB');
        expect(renderAnalysisMarkdown(result)).toContain('Large files (≥ 1 MB)');
        expect(renderAnalysisHtml(result)).toContain('Large files ≥ 1 MB');
        expect(formatBudgetActual(result.budgets![0]!, 'iec')).toBe('1.5 MB');
        expect(formatBudgetActual(result.budgets![1]!, 'iec')).toBe('1');
        const binary = { ...parseBudget('size<=1MiB'), actual: 1_048_576, passed: true };
        expect(formatBudgetActual(binary, 'si')).toBe('1 MiB');
    });

    it.skipIf(isWindows)('uses singular nouns for counts of one', async () => {
        const root = await fixture({ 'a.bin': bytes(10), 'b.bin': { hardlink: 'a.bin' } });
        expect(renderAnalysis(await analyze(root))).toContain('1 extra link counted once');

        const sides = await fixture({ 'l/a.md': 'a', 'r/a.md': 'a', 'r/b.md': 'b' });
        const text = renderComparison(await compare(join(sides, 'l'), join(sides, 'r')));
        expect(text).toContain('+1 file');
        expect(text).not.toContain('+1 files');
    });

    it('reports a mistyped size as invalid instead of as an extra folder', async () => {
        expect(normalizeArgv(['-l', '5parsecs', '.'])).toEqual(['-l', '5parsecs', '.']);
        expect(normalizeArgv(['--stale', '2yrs'])).toEqual(['--stale', '2yrs']);
        const root = await fixture({ '2024-photos/a.jpg': 'x' });
        // A real folder that starts with a digit is still treated as the directory.
        expect(normalizeArgv(['-l', '2024-photos'], root)).toEqual([
            '--large-files=',
            '2024-photos',
        ]);

        const result = await cli([root, '-l', '5parsecs']);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('Invalid size "5parsecs"');
        expect(result.stderr).not.toContain('too many arguments');
    });

    it('throttles hashing progress instead of reporting every file', async () => {
        const tree: Record<string, string> = {};
        for (let i = 0; i < 300; i++) tree[`f${i}.txt`] = `same-size-${String(i).padStart(4, '0')}`;
        const root = await fixture(tree);
        let hashEvents = 0;
        await analyze(root, {
            duplicates: true,
            progressInterval: 60_000,
            onProgress: (p) => {
                if (p.phase === 'hash') hashEvents++;
            },
        });
        // Only the start and the end of the full-hash stage get through.
        expect(hashEvents).toBeLessThanOrEqual(4);
        expect(hashEvents).toBeGreaterThan(0);
    });

    it('does not print a percentage when nothing changed', async () => {
        const root = await fixture({ 'a/x': 'x' });
        const text = renderComparison(await compare(join(root, 'a'), join(root, 'a')));
        expect(text).not.toContain('0.0%');
    });

    it('keeps the HTML report scannable', async () => {
        const tree: Record<string, string> = {};
        for (let i = 0; i < 150; i++) {
            tree[`a/copy-${i}.txt`] = `content-${i}`;
            tree[`b/copy-${i}.txt`] = `content-${i}`;
        }
        tree['deep/nested/file.txt'] = 'x';
        const root = await fixture(tree);
        const html = renderAnalysisHtml(await analyze(root, { duplicates: true, tree: true }));
        // At most 100 duplicate groups, each naming its first file in the collapsed row.
        expect(html.match(/<details class="group">/g)).toHaveLength(100);
        expect(html).toMatch(
            /<summary><strong>[^<]+<\/strong> <span class="muted">2 × [^<]+<\/span> <span class="path first">a\/copy-/
        );
        expect(html).toContain('Showing 100 of 150');
        // Tree folders show an expand marker; dates never wrap.
        expect(html).toContain(".tree summary::before{content:'▸'}");
        expect(html).toContain('td.date{white-space:nowrap}');
    });
});
