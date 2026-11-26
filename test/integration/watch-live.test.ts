import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL_SCAN_EVERY_MS, needsFullScan } from '../../src/cli/commands/watch.ts';
import { analyze } from '../../src/core/analyze.ts';
import type { AnalysisResult } from '../../src/types.ts';
import { cli } from '../helpers/cli.ts';
import { fixture } from '../helpers/fixture.ts';

const reports = (text: string): AnalysisResult[] =>
    text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AnalysisResult);

function comparable(result: AnalysisResult): unknown {
    const { durationMs: _d, startedAt: _s, ...rest } = result;
    return rest;
}

describe('dat watch, incremental (#34)', () => {
    it('prints after each change what a full scan of the tree would print', async () => {
        const root = await fixture({
            'a/one.txt': 'same',
            'a/b/two.txt': 'same',
            'c/three.log': 'x'.repeat(50),
            'empty.txt': '',
        });
        const controller = new AbortController();
        let output = '';
        const running = cli(
            ['watch', root, '--json', '-d', '-t', '--empty', '-x', '-n', '3', '--debounce', '20'],
            { signal: controller.signal, onStdout: (text) => (output = text) }
        );
        const options = {
            duplicates: true,
            tree: true,
            empty: true,
            top: 3,
        };
        const changes: Array<() => Promise<unknown>> = [
            () => writeFile(join(root, 'a/b/four.txt'), 'same'),
            () =>
                mkdir(join(root, 'new/deep'), { recursive: true }).then(() =>
                    writeFile(join(root, 'new/deep/five.txt'), 'y'.repeat(70))
                ),
            () => rename(join(root, 'a/b'), join(root, 'a/moved')),
            () => rm(join(root, 'c'), { recursive: true }),
            () => writeFile(join(root, 'a/one.txt'), 'diff'),
        ];
        await expect
            .poll(() => reports(output).length, { timeout: 10_000 })
            .toBeGreaterThanOrEqual(1);
        // FSEvents can also deliver the fixture's own creation; let those reports pass first.
        await expect
            .poll(() => comparable(reports(output).at(-1)!), { timeout: 10_000, interval: 50 })
            .toEqual(comparable(await analyze(root, options)));
        await new Promise((resolve) => setTimeout(resolve, 300));
        for (const [i, change] of changes.entries()) {
            const before = reports(output).length;
            await change();
            const expected = comparable(await analyze(root, options));
            await expect
                .poll(() => comparable(reports(output).at(-1)!), { timeout: 10_000, interval: 50 })
                .toEqual(expected);
            expect(reports(output).length, `change ${i}`).toBeGreaterThan(before);
        }
        controller.abort();
        expect((await running).code).toBe(130);
    });

    it('still reports every change with a relative date, by scanning in full', async () => {
        const root = await fixture({ 'a/old.txt': 'x' });
        const controller = new AbortController();
        let output = '';
        const running = cli(['watch', root, '--json', '--stale', '1y', '--debounce', '20'], {
            signal: controller.signal,
            onStdout: (text) => (output = text),
        });
        await expect.poll(() => reports(output).length, { timeout: 10_000 }).toBeGreaterThan(0);
        await writeFile(join(root, 'a/new.txt'), 'yy');
        await expect.poll(() => reports(output).at(-1)?.summary.files, { timeout: 10_000 }).toBe(2);
        controller.abort();
        expect((await running).code).toBe(130);
    });

    it('scans in full again after ten minutes of changes', () => {
        expect(needsFullScan(0, FULL_SCAN_EVERY_MS - 1)).toBe(false);
        expect(needsFullScan(0, FULL_SCAN_EVERY_MS)).toBe(true);
        expect(FULL_SCAN_EVERY_MS).toBe(10 * 60 * 1000);
    });
});
